// Purpose: Recognize bounded UTF-8 HTML without constructing a DOM or running active content.
// Pattern: html5ever tokenizes documents/fragments; original bytes remain immutable.
// Usage: The existing bounded Blob worker calls this before library registration.
// Related: mod.rs, modules/assets/mod.rs, html5ever tokenizer, HTTP download headers.
use crate::modules::assets::{Error, MAX_FILE_BYTES};
use file_format::FileFormat;
use html5ever::tokenizer::{
    BufferQueue, StartTag, Token, TokenSink, TokenSinkResult, Tokenizer, states::RawKind,
};
use std::{cell::Cell, fs::File, io::Read};
use tokio_util::sync::CancellationToken;
const MAX_TOKENS: usize = 1_000_000;
#[derive(Default)]
struct Inspection {
    markup: Cell<bool>,
    tokens: Cell<usize>,
    complex: Cell<bool>,
}
impl TokenSink for Inspection {
    type Handle = ();
    fn process_token(&self, token: Token, _: u64) -> TokenSinkResult<()> {
        self.tokens.set(self.tokens.get().saturating_add(1));
        if self.tokens.get() > MAX_TOKENS {
            self.complex.set(true);
        }
        match token {
            Token::DoctypeToken(doctype) if doctype.name.as_deref() == Some("html") => {
                self.markup.set(true);
            }
            Token::TagToken(tag) if tag.kind == StartTag => {
                self.markup.set(true);
                if tag.attrs.len() > 4096 {
                    self.complex.set(true);
                }
                // Respect text-only contexts; the tokenizer never executes scripts or fetches URLs.
                return match tag.name.as_ref() {
                    "script" => TokenSinkResult::RawData(RawKind::ScriptData),
                    "style" | "xmp" | "iframe" | "noembed" | "noframes" => {
                        TokenSinkResult::RawData(RawKind::Rawtext)
                    }
                    "title" | "textarea" => TokenSinkResult::RawData(RawKind::Rcdata),
                    "plaintext" => TokenSinkResult::Plaintext,
                    _ => TokenSinkResult::Continue,
                };
            }
            _ => {}
        }
        TokenSinkResult::Continue
    }
}
pub(super) fn inspect(
    file: &mut File,
    detected: FileFormat,
    cancel: &CancellationToken,
) -> Result<(), Error> {
    if !matches!(
        detected,
        FileFormat::HypertextMarkupLanguage
            | FileFormat::PlainText
            | FileFormat::ArbitraryBinaryData
    ) {
        return Err(Error::InvalidContent);
    }
    let mut text = String::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::InvalidData {
                Error::HtmlEncoding
            } else {
                Error::Storage
            }
        })?;
    if text.len() as u64 > MAX_FILE_BYTES {
        return Err(Error::TooLarge);
    }
    if text
        .bytes()
        .any(|b| matches!(b, 0..=8 | 11 | 14..=31 | 127))
    {
        return Err(Error::InvalidContent);
    }
    let tokenizer = Tokenizer::new(Inspection::default(), Default::default());
    let input = BufferQueue::default();
    let mut remaining = text.as_str();
    while !remaining.is_empty() {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let end = remaining.floor_char_boundary(remaining.len().min(65536));
        input.push_back(remaining[..end].into());
        let _ = tokenizer.feed(&input);
        if tokenizer.sink.complex.get() {
            return Err(Error::HtmlComplexity);
        }
        remaining = &remaining[end..];
    }
    tokenizer.end();
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    if tokenizer.sink.complex.get() {
        return Err(Error::HtmlComplexity);
    }
    if !tokenizer.sink.markup.get() {
        return Err(Error::InvalidContent);
    }
    Ok(())
}
