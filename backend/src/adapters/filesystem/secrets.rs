// Purpose: Protect provider tokens with a local or externally supplied encryption key.
// Pattern: XChaCha20Poly1305 envelope, random nonce and config-ID authenticated context.
// Usage: Open once during startup; never return decrypted credentials through HTTP.
// Related: modules/model_registry/ports.rs, app/mod.rs, backup documentation.
use crate::modules::model_registry::{Error, SecretCodec};
use anyhow::{Context, ensure};
use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305,
    aead::{Aead, Payload},
};
use secrecy::{ExposeSecret, SecretBox, SecretString};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::Path,
};
use uuid::Uuid;
pub(crate) struct Secrets(XChaCha20Poly1305);
impl Secrets {
    pub fn open(root: &Path, external: Option<&Path>, has_secrets: bool) -> anyhow::Result<Self> {
        let path = external
            .map(Path::to_path_buf)
            .unwrap_or_else(|| root.join("config/secret.key"));
        ensure!(
            path.is_absolute(),
            "secret key file must be an absolute path"
        );
        if !path.try_exists()? {
            ensure!(
                external.is_none() && !has_secrets,
                "encryption key missing; restore the original key, do not regenerate"
            );
            let mut bytes = SecretBox::new(Box::new([0_u8; 32]));
            use secrecy::ExposeSecretMut;
            getrandom::fill(bytes.expose_secret_mut())?;
            let mut file = tempfile::NamedTempFile::new_in(root.join("config"))?;
            file.write_all(bytes.expose_secret())?;
            file.as_file().sync_all()?;
            file.persist_noclobber(&path)
                .context("could not create secret key")?;
            File::open(root.join("config"))?.sync_all()?;
        }
        let meta = fs::symlink_metadata(&path)?;
        // External Kubernetes Secret files may be symlinks; internal key files may not.
        ensure!(
            external.is_some() || !meta.file_type().is_symlink(),
            "internal secret key cannot be a symlink"
        );
        let mut file = File::open(&path)?;
        ensure!(
            file.metadata()?.is_file() && file.metadata()?.len() == 32,
            "secret key must contain exactly 32 raw bytes"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            ensure!(
                external.is_some() || file.metadata()?.permissions().mode() & 0o077 == 0,
                "internal secret key permissions must be 0600"
            );
        }
        let mut bytes = Box::new([0_u8; 32]);
        file.read_exact(bytes.as_mut())?;
        let key = SecretBox::new(bytes);
        Ok(Self(
            XChaCha20Poly1305::new_from_slice(key.expose_secret())
                .map_err(|_| anyhow::anyhow!("invalid encryption key"))?,
        ))
    }
}
impl SecretCodec for Secrets {
    fn encrypt(&self, id: Uuid, value: &str) -> Result<String, Error> {
        let mut nonce = [0_u8; 24];
        getrandom::fill(&mut nonce).map_err(|_| Error::Secret)?;
        let bytes = self
            .0
            .encrypt(
                (&nonce).into(),
                Payload {
                    msg: value.as_bytes(),
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| Error::Secret)?;
        Ok(format!("v1:{}:{}", hex::encode(nonce), hex::encode(bytes)))
    }
    fn decrypt(&self, id: Uuid, value: &str) -> Result<SecretString, Error> {
        let parts = value.split(':').collect::<Vec<_>>();
        if parts.len() != 3 || parts[0] != "v1" {
            return Err(Error::Secret);
        }
        let nonce: [u8; 24] = hex::decode(parts[1])
            .map_err(|_| Error::Secret)?
            .try_into()
            .map_err(|_| Error::Secret)?;
        let ciphertext = hex::decode(parts[2]).map_err(|_| Error::Secret)?;
        let bytes = self
            .0
            .decrypt(
                (&nonce).into(),
                Payload {
                    msg: &ciphertext,
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| Error::Secret)?;
        Ok(String::from_utf8(bytes).map_err(|_| Error::Secret)?.into())
    }
}
