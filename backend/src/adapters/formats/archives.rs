// Purpose: Check ZIP/XML document identity and resource limits without extracting paths.
// Pattern: Library parsers handle ZIP/XML; the adapter enforces supported container policy.
// Usage: Called for DOCX, PPTX, XLSX and HWPX before immutable Blob publication.
// Related: mod.rs, modules/assets/mod.rs, zip and quick-xml.
use crate::modules::assets::{Error, Format};
use std::{collections::HashSet, fs::File, io::Read};
use tokio_util::sync::CancellationToken;
const MAX_EXPANDED: u64 = 250 * 1024 * 1024;
const MAX_ENTRY: u64 = 64 * 1024 * 1024;
const MAX_XML: usize = 2 * 1024 * 1024;
pub(super) fn inspect(
    file: &mut File,
    format: Format,
    cancel: &CancellationToken,
) -> Result<(), Error> {
    let mut zip = zip::ZipArchive::new(file).map_err(|_| Error::InvalidContent)?;
    if zip.is_empty() || zip.len() > 4096 {
        return Err(Error::TooLarge);
    }
    if zip
        .has_overlapping_entries()
        .map_err(|_| Error::InvalidContent)?
    {
        return Err(Error::InvalidContent);
    }
    let mut names = HashSet::new();
    let mut total = 0u64;
    let mut content_types = None;
    let mut hwpx_mime = None;
    for index in 0..zip.len() {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let mut entry = zip.by_index(index).map_err(|_| Error::InvalidContent)?;
        if entry.encrypted() {
            return Err(Error::Encrypted);
        }
        let name = entry
            .name()
            .map_err(|_| Error::InvalidContent)?
            .into_owned();
        if entry.enclosed_name().is_none()
            || name.contains('\\')
            || entry.is_symlink()
            || !names.insert(name.clone())
        {
            return Err(Error::InvalidContent);
        }
        if entry.size() > MAX_ENTRY
            || entry.size() > entry.compressed_size().max(1).saturating_mul(1000)
        {
            return Err(Error::TooLarge);
        }
        if name.to_ascii_lowercase().ends_with("vbaproject.bin") {
            return Err(Error::InvalidContent);
        }
        let capture = name == "[Content_Types].xml" || name == "mimetype";
        let mut data = Vec::new();
        let mut actual = 0u64;
        let mut buffer = [0u8; 65536];
        loop {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let count = entry.read(&mut buffer).map_err(|_| Error::InvalidContent)?;
            if count == 0 {
                break;
            }
            actual += count as u64;
            total += count as u64;
            if total > MAX_EXPANDED || actual > MAX_ENTRY {
                return Err(Error::TooLarge);
            }
            if capture {
                if data.len() + count > MAX_XML {
                    return Err(Error::TooLarge);
                }
                data.extend_from_slice(&buffer[..count]);
            }
        }
        if actual != entry.size() {
            return Err(Error::InvalidContent);
        }
        if name == "[Content_Types].xml" {
            content_types = Some(data);
        } else if name == "mimetype" {
            hwpx_mime = Some(data);
        }
    }
    if format == Format::Hwpx {
        if hwpx_mime.as_deref() != Some(b"application/hwp+zip")
            || !names.contains("Contents/content.hpf")
            || !names.contains("Contents/section0.xml")
        {
            return Err(Error::InvalidContent);
        }
        return Ok(());
    }
    let (part, content) = match format {
        Format::Docx => (
            "word/document.xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        ),
        Format::Pptx => (
            "ppt/presentation.xml",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        ),
        Format::Xlsx => (
            "xl/workbook.xml",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        ),
        _ => return Err(Error::InvalidContent),
    };
    if !names.contains(part) || !names.contains("_rels/.rels") {
        return Err(Error::InvalidContent);
    }
    content_type(&content_types.ok_or(Error::InvalidContent)?, part, content)
}
fn content_type(xml: &[u8], part: &str, expected: &str) -> Result<(), Error> {
    use quick_xml::{
        events::Event,
        name::{Namespace, ResolveResult},
        reader::NsReader,
    };
    let mut reader = NsReader::from_reader(xml);
    let mut found = false;
    let mut root = false;
    let mut depth = 0usize;
    let mut count = 0usize;
    loop {
        let (namespace, event) = reader
            .read_resolved_event()
            .map_err(|_| Error::InvalidContent)?;
        count += 1;
        if count > 100_000 {
            return Err(Error::TooLarge);
        }
        match event {
            Event::DocType(_) => return Err(Error::InvalidContent),
            Event::Decl(decl) => {
                if let Some(encoding) = decl.encoding() {
                    let encoding = encoding.map_err(|_| Error::InvalidContent)?;
                    if !encoding.eq_ignore_ascii_case("utf-8") {
                        return Err(Error::InvalidContent);
                    }
                }
            }
            Event::Start(ref element) | Event::Empty(ref element) => {
                if !matches!(
                    namespace,
                    ResolveResult::Bound(Namespace(
                        "http://schemas.openxmlformats.org/package/2006/content-types"
                    ))
                ) {
                    return Err(Error::InvalidContent);
                }
                if !root {
                    if element.local_name().as_ref() != "Types" {
                        return Err(Error::InvalidContent);
                    }
                    root = true;
                }
                if element.local_name().as_ref() == "Override" {
                    let mut path = None;
                    let mut mime = None;
                    for attribute in element.attributes() {
                        let a = attribute.map_err(|_| Error::InvalidContent)?;
                        let value = a
                            .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                            .map_err(|_| Error::InvalidContent)?
                            .into_owned();
                        match a.key.as_ref() {
                            "PartName" => path = Some(value),
                            "ContentType" => mime = Some(value),
                            _ => {}
                        }
                    }
                    if path.as_deref() == Some(&format!("/{part}"))
                        && mime.as_deref() == Some(expected)
                    {
                        found = true;
                    }
                }
                if matches!(event, Event::Start(_)) {
                    depth += 1;
                    if depth > 128 {
                        return Err(Error::TooLarge);
                    }
                }
            }
            Event::End(_) => {
                depth = depth.checked_sub(1).ok_or(Error::InvalidContent)?;
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if root && found && depth == 0 {
        Ok(())
    } else {
        Err(Error::InvalidContent)
    }
}
