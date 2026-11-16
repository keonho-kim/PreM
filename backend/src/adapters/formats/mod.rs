// Purpose: Inspect uploaded document containers with maintained parsers and bounded reads.
// Pattern: Format identification is separate from extraction, rendering and malware scanning.
// Usage: Blob publication invokes this on a bounded blocking worker before DB registration.
// Related: archives.rs, modules/assets/mod.rs, file-format, cfb, quick-xml and zip.
mod archives;
mod html;
use crate::modules::assets::{Error, Format};
use std::{
    fs::File,
    io::{Read, Seek},
};
use tokio_util::sync::CancellationToken;
pub(crate) fn inspect(
    file: &mut File,
    format: Format,
    cancel: &CancellationToken,
) -> Result<(), Error> {
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    file.rewind().map_err(|_| Error::Storage)?;
    let mut prefix = [0; 8192];
    let n = file.read(&mut prefix).map_err(|_| Error::Storage)?;
    let detected = file_format::FileFormat::from_bytes(&prefix[..n]);
    file.rewind().map_err(|_| Error::Storage)?;
    match format {
        Format::Html => html::inspect(file, detected, cancel),
        Format::Markdown => super::markdown::inspect(file, detected, cancel),
        Format::Pdf => {
            if detected != file_format::FileFormat::PortableDocumentFormat {
                return Err(Error::InvalidContent);
            }
            let document = lopdf::Document::load_from(file).map_err(|_| Error::InvalidContent)?;
            if document.is_encrypted() {
                return Err(Error::Encrypted);
            }
            let pages = document.get_pages().len();
            if pages == 0 {
                return Err(Error::InvalidContent);
            }
            if pages > 2000 {
                return Err(Error::TooLarge);
            }
            Ok(())
        }
        Format::Hwp => {
            if detected != file_format::FileFormat::CompoundFileBinary {
                return Err(Error::InvalidContent);
            }
            let mut compound = cfb::CompoundFile::open(file).map_err(|_| Error::InvalidContent)?;
            let mut header = compound
                .open_stream("FileHeader")
                .map_err(|_| Error::InvalidContent)?;
            let mut bytes = [0; 40];
            header
                .read_exact(&mut bytes)
                .map_err(|_| Error::InvalidContent)?;
            if !bytes.starts_with(b"HWP Document File") || bytes[35] != 5 {
                return Err(Error::InvalidContent);
            }
            if u32::from_le_bytes(
                bytes[36..40]
                    .try_into()
                    .map_err(|_| Error::InvalidContent)?,
            ) & 2
                != 0
            {
                return Err(Error::Encrypted);
            }
            Ok(())
        }
        _ => {
            if detected != file_format::FileFormat::Zip {
                return Err(Error::InvalidContent);
            }
            archives::inspect(file, format, cancel)
        }
    }
}
