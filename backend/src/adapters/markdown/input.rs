// Purpose: Reject binary, incorrectly encoded and unbounded Markdown before registration.
// Pattern: UTF-8 text is valid Markdown even without formatting; original bytes are never changed.
// Usage: Upload inspection and extraction share the same byte/line/control constraints.
// Related: mod.rs, modules/assets/mod.rs.
use crate::modules::assets::Error;
use file_format::FileFormat;
use std::{fs::File, io::Read};
use tokio_util::sync::CancellationToken;
pub(super) const MAX_BYTES: usize = 2 * 1024 * 1024;
pub(super) fn text(bytes: &[u8]) -> Result<&str, Error> {
    if bytes.len() > MAX_BYTES {
        return Err(Error::MarkdownLimit);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| Error::MarkdownEncoding)?;
    if text.trim_start_matches('\u{feff}').trim().is_empty()
        || text
            .bytes()
            .any(|b| matches!(b, 0..=8 | 11..=12 | 14..=31 | 127))
    {
        return Err(Error::InvalidContent);
    }
    if text.lines().count() > 50000 || text.lines().any(|line| line.len() > 65536) {
        return Err(Error::MarkdownLimit);
    }
    Ok(text)
}
pub(crate) fn inspect(
    file: &mut File,
    detected: FileFormat,
    cancel: &CancellationToken,
) -> Result<(), Error> {
    if !matches!(
        detected,
        FileFormat::PlainText
            | FileFormat::HypertextMarkupLanguage
            | FileFormat::ExtensibleMarkupLanguage
            | FileFormat::ArbitraryBinaryData
    ) {
        return Err(Error::InvalidContent);
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::Storage)?;
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    text(&bytes).map(|_| ())
}
