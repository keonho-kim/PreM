// Purpose: Adapt bounded Markdown uploads into passive canonical document blocks using Comrak.
// Pattern: Shared input validation and native AST conversion; no HTML rendering or URL fetching.
// Usage: Format inspection and the document extractor call this adapter directly.
// Related: input.rs, blocks.rs, inline.rs, Comrak 0.59.0.
mod blocks;
mod inline;
mod input;
use crate::modules::documents::{Error, Extracted, ExtractedPage};
use comrak::{Arena, Options, parse_document};
pub(super) use input::inspect;
use tokio_util::sync::CancellationToken;
pub(super) const PROFILE: &str = "markdown-comrak-0.59.0-gfm-passive-v1";

pub(super) fn extract(bytes: Vec<u8>, cancel: CancellationToken) -> Result<Extracted, Error> {
    let text = input::text(&bytes).map_err(|_| Error::Processing("invalid_markdown"))?;
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let arena = Arena::new();
    let mut options = Options::default();
    options.extension.table = true;
    options.extension.tasklist = true;
    options.extension.strikethrough = true;
    options.extension.autolink = true;
    options.extension.footnotes = true;
    options.parse.sourcepos_chars = true;
    let root = parse_document(
        &arena,
        text.strip_prefix('\u{feff}').unwrap_or(text),
        &options,
    );
    let blocks = blocks::convert(root, &cancel)?;
    Ok(Extracted {
        native: None,
        schema_version: 2,
        page_mode: "unpaginated".into(),
        warnings: vec!["MARKDOWN_PASSIVE_RESOURCES".into()],
        pages: vec![ExtractedPage {
            preview: None,
            source_page: None,
            label: "Markdown 본문".into(),
            blocks,
        }],
        files: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn long_korean_code_preserves_every_character_and_cancelled_work_stops() {
        let code = format!("{}\n", "한글 코드 내용 ".repeat(1000));
        let source = format!("```text\n{code}```\n");
        let result = extract(source.clone().into_bytes(), CancellationToken::new()).unwrap();
        let blocks = &result.pages[0].blocks;
        assert!(blocks.len() > 1);
        assert_eq!(
            blocks.iter().map(|b| b.text.as_str()).collect::<String>(),
            code
        );
        assert!(
            blocks
                .iter()
                .all(|b| b.kind == "code" && b.text.len() <= 6000)
        );
        let stop = CancellationToken::new();
        stop.cancel();
        assert!(matches!(
            extract(source.into_bytes(), stop),
            Err(Error::Cancelled)
        ));
    }
}
