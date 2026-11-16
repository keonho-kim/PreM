// Purpose: Define normalized packages whose payloads live once in the common Blob Store.
// Pattern: A sorted immutable manifest references independently hashed files, never nested ZIP bytes.
// Usage: PPT import commits the manifest and members; downloads assemble a transient ZIP.
// Related: filesystem/packages.rs, modules/ppt_imports/, V12__shared_ppt_packages.sql.
use serde::{Deserialize, Serialize};
pub(crate) const PACKAGE_MIME: &str = "application/vnd.puputyx.package+json";
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Package {
    pub schema_version: u32,
    pub files: Vec<PackageFile>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PackageFile {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}
impl Package {
    pub fn validate(&self) -> Result<(), super::Error> {
        let mut previous = "";
        let mut total = 0u64;
        if self.schema_version != 1 || self.files.is_empty() || self.files.len() > 10000 {
            return Err(super::Error::InvalidContent);
        }
        for f in &self.files {
            total = total.checked_add(f.size).ok_or(super::Error::TooLarge)?;
            if f.path.as_str() <= previous
                || f.path.len() > 500
                || f.path.contains(['\\', ':'])
                || f.path.chars().any(char::is_control)
                || f.path
                    .split('/')
                    .any(|p| p.is_empty() || p == "." || p == "..")
                || f.sha256.len() != 64
                || !f
                    .sha256
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                || (f.size == 0
                    && f.sha256
                        != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
                || total > 160 * 1024 * 1024
            {
                return Err(super::Error::InvalidContent);
            }
            previous = &f.path;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn file(path: &str) -> PackageFile {
        PackageFile {
            path: path.into(),
            sha256: "a".repeat(64),
            size: 1,
        }
    }
    #[test]
    fn package_paths_order_sizes_and_empty_files_are_unambiguous() {
        let package = |files| Package {
            schema_version: 1,
            files,
        };
        assert!(
            package(vec![
                file("analysis/manifest.json"),
                file("images/그림.png")
            ])
            .validate()
            .is_ok()
        );
        for path in [
            "/outside",
            "../outside",
            "images/../file",
            "./file",
            "C:/file",
            "a\\b",
            "a//b",
            "a/",
            "a\n",
        ] {
            assert!(package(vec![file(path)]).validate().is_err(), "{path}");
        }
        assert!(
            package(vec![file("same"), file("same")])
                .validate()
                .is_err()
        );
        assert!(package(vec![file("z"), file("a")]).validate().is_err());
        let mut oversized = file("a");
        oversized.size = 160 * 1024 * 1024 + 1;
        assert!(package(vec![oversized]).validate().is_err());
        let mut empty = file("empty");
        empty.size = 0;
        assert!(package(vec![empty.clone()]).validate().is_err());
        empty.sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into();
        assert!(package(vec![empty]).validate().is_ok());
    }
}
