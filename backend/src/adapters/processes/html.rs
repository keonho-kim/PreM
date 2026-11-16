// Purpose: Extract passive HTML text blocks without DOM execution or external resource fetching.
// Pattern: Existing html5ever tokenizer preserves structural boundaries and ignores active/head text.
// Usage: Reference HTML processing; original downloads remain attachment-only.
// Related: formats/html.rs, documents.rs, modules/documents/types.rs.
use crate::modules::documents::*;
use html5ever::tokenizer::{
    BufferQueue, StartTag, Token, TokenSink, TokenSinkResult, Tokenizer, states::RawKind,
};
use std::cell::RefCell;
use tokio_util::sync::CancellationToken;
#[derive(Default)]
struct State {
    hidden: Vec<String>,
    text: String,
    kind: String,
    blocks: Vec<ExtractedBlock>,
    list_depth: usize,
    table_depth: usize,
    tokens: usize,
}
impl State {
    fn flush(&mut self) {
        let text = self.text.trim().to_owned();
        self.text.clear();
        if text.is_empty() {
            return;
        }
        let mut remaining = text.as_str();
        while !remaining.is_empty() {
            let end = remaining.floor_char_boundary(remaining.len().min(6000));
            let chunk = &remaining[..end];
            self.blocks.push(ExtractedBlock {
                kind: if self.kind.is_empty() {
                    "paragraph".into()
                } else {
                    self.kind.clone()
                },
                text: chunk.into(),
                attributes: serde_json::json!({}),
            });
            remaining = &remaining[end..];
        }
    }
}
#[derive(Default)]
struct Sink(RefCell<State>);
impl TokenSink for Sink {
    type Handle = ();
    fn process_token(&self, token: Token, _: u64) -> TokenSinkResult<()> {
        let mut s = self.0.borrow_mut();
        s.tokens += 1;
        match token {
            Token::TagToken(tag) => {
                let name = tag.name.to_string();
                let start = tag.kind == StartTag;
                if ["head", "script", "style", "iframe", "noscript", "template"]
                    .contains(&name.as_str())
                {
                    if start {
                        s.hidden.push(name.clone());
                    } else if s.hidden.last() == Some(&name) {
                        s.hidden.pop();
                    }
                    if start && name == "script" {
                        return TokenSinkResult::RawData(RawKind::ScriptData);
                    }
                    if start && ["style", "iframe"].contains(&name.as_str()) {
                        return TokenSinkResult::RawData(RawKind::Rawtext);
                    }
                    return TokenSinkResult::Continue;
                }
                if !s.hidden.is_empty() {
                    return TokenSinkResult::Continue;
                }
                if ["ul", "ol"].contains(&name.as_str()) {
                    if start {
                        if s.list_depth == 0 {
                            s.flush();
                            s.kind = "list".into();
                        }
                        s.list_depth += 1;
                    } else {
                        s.list_depth = s.list_depth.saturating_sub(1);
                        if s.list_depth == 0 {
                            s.flush();
                            s.kind = "paragraph".into();
                        }
                    }
                } else if name == "table" {
                    if start {
                        if s.table_depth == 0 {
                            s.flush();
                            s.kind = "table".into();
                        }
                        s.table_depth += 1;
                    } else {
                        s.table_depth = s.table_depth.saturating_sub(1);
                        if s.table_depth == 0 {
                            s.flush();
                            s.kind = "paragraph".into();
                        }
                    }
                } else if ["br", "li", "tr"].contains(&name.as_str()) {
                    if start {
                        s.text.push('\n');
                    }
                } else if ["td", "th"].contains(&name.as_str()) {
                    if !start {
                        s.text.push_str(" | ");
                    }
                } else if s.list_depth == 0
                    && s.table_depth == 0
                    && [
                        "p", "div", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6",
                    ]
                    .contains(&name.as_str())
                {
                    s.flush();
                    s.kind = if start && name.starts_with('h') {
                        "heading".into()
                    } else {
                        "paragraph".into()
                    };
                } else if start && name == "img" {
                    let alt = tag
                        .attrs
                        .iter()
                        .find(|a| &*a.name.local == "alt")
                        .map(|a| a.value.to_string())
                        .unwrap_or_default();
                    if !alt.is_empty() {
                        s.text.push_str(&format!(" [이미지: {alt}] "));
                    }
                }
            }
            Token::CharacterTokens(text) if s.hidden.is_empty() => s.text.push_str(&text),
            _ => (),
        }
        TokenSinkResult::Continue
    }
}
pub(super) fn extract(bytes: Vec<u8>, cancel: CancellationToken) -> Result<Extracted, Error> {
    let text = String::from_utf8(bytes).map_err(|_| Error::Processing("html_encoding"))?;
    let tokenizer = Tokenizer::new(Sink::default(), Default::default());
    let queue = BufferQueue::default();
    let mut remaining = text.as_str();
    while !remaining.is_empty() {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let end = remaining.floor_char_boundary(remaining.len().min(65536));
        queue.push_back(remaining[..end].into());
        let _ = tokenizer.feed(&queue);
        remaining = &remaining[end..];
        let s = tokenizer.sink.0.borrow();
        if s.tokens > 1_000_000 || s.blocks.len() > 20000 {
            return Err(Error::Processing("extraction_limit"));
        }
    }
    tokenizer.end();
    let mut s = tokenizer.sink.0.borrow_mut();
    s.flush();
    Ok(Extracted {
        native: None,
        schema_version: 2,
        page_mode: "unpaginated".into(),
        warnings: vec!["HTML_EXTERNAL_RESOURCES_NOT_FETCHED".into()],
        pages: vec![ExtractedPage {
            source_page: None,
            label: "HTML 본문".into(),
            preview: None,
            blocks: std::mem::take(&mut s.blocks),
        }],
        files: vec![],
    })
}
