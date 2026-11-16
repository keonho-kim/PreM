// Purpose: Own validated provider settings and immutable configuration changes.
// Pattern: Feature facade with narrow persistence and secret-encryption ports.
// Usage: Admin saves settings; inference pins one configuration per request.
// Related: ports.rs, adapters/sqlite/providers.rs, adapters/filesystem/secrets.rs.
mod decision_catalog;
mod discovery;
pub(crate) use discovery::DiscoveryInput;
mod kind;
mod ports;
pub(crate) use kind::{ProviderDescriptor, ProviderKind};
pub(crate) use ports::{ProviderStore, SecretCodec, StoreFuture};
use secrecy::SecretString;
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("{0}")]
    Invalid(&'static str),
    #[error("프로바이더를 찾을 수 없습니다.")]
    NotFound,
    #[error("설정이 변경되었습니다. 최신 설정을 확인한 뒤 다시 저장하세요.")]
    Conflict,
    #[error("저장소를 사용할 수 없습니다. 다시 시도하세요.")]
    Unavailable,
    #[error("인증 정보를 읽을 수 없습니다. 암호화 키와 백업을 확인하세요.")]
    Secret,
}
#[derive(Clone)]
pub(crate) struct Settings {
    pub name: String,
    pub provider_type: ProviderKind,
    pub base_url: String,
    pub model_identifier: String,
    pub timeout_seconds: u32,
    pub enabled: bool,
}
impl Settings {
    pub fn validate(mut self) -> Result<Self, Error> {
        self.name = self.name.trim().to_owned();
        self.model_identifier = self.model_identifier.trim().to_owned();
        if self.name.is_empty()
            || self.name.chars().count() > 80
            || self.name.chars().any(char::is_control)
        {
            return Err(Error::Invalid(
                "표시 이름은 제어 문자 없이 1~80자로 입력하세요.",
            ));
        }
        if self.model_identifier.is_empty()
            || self.model_identifier.len() > 200
            || self.model_identifier.chars().any(char::is_control)
        {
            return Err(Error::Invalid(
                "서버가 제공하는 모델 ID를 1~200자로 입력하세요.",
            ));
        }
        if !(5..=180).contains(&self.timeout_seconds) {
            return Err(Error::Invalid("제한 시간은 5~180초입니다."));
        }
        self.base_url = normalize_base_url(&self.base_url)?;
        Ok(self)
    }
}
#[derive(Clone)]
pub(crate) struct Provider {
    pub id: Uuid,
    pub config_id: Uuid,
    pub version: i64,
    pub settings: Settings,
    pub encrypted_secret: Option<String>,
    pub created_at: i64,
}
pub(crate) struct Credentials {
    pub connection_id: Uuid,
    pub config_id: Uuid,
    pub kind: ProviderKind,
    pub base_url: String,
    pub model_identifier: String,
    pub timeout_seconds: u32,
    pub token: Option<SecretString>,
}
#[derive(Clone)]
pub(crate) struct Registry {
    store: Arc<dyn ProviderStore>,
    secrets: Arc<dyn SecretCodec>,
}
impl Registry {
    pub fn new(store: Arc<dyn ProviderStore>, secrets: Arc<dyn SecretCodec>) -> Self {
        Self { store, secrets }
    }
    pub async fn list(&self) -> Result<Vec<Provider>, Error> {
        self.store.list().await
    }
    pub async fn get(&self, id: Uuid) -> Result<Provider, Error> {
        self.store.get(id).await
    }
    pub async fn save(
        &self,
        id: Uuid,
        expected: i64,
        settings: Settings,
        token: Option<String>,
        clear: bool,
    ) -> Result<Provider, Error> {
        let settings = settings.validate()?;
        if expected < 0 {
            return Err(Error::Invalid("기준 버전이 올바르지 않습니다."));
        }
        if clear && token.is_some() {
            return Err(Error::Invalid(
                "인증 정보 변경과 삭제를 동시에 요청할 수 없습니다.",
            ));
        }
        let previous = if expected == 0 {
            None
        } else {
            Some(self.get(id).await?)
        };
        if previous.as_ref().is_some_and(|p| p.version != expected) {
            return Err(Error::Conflict);
        }
        // Keeping an existing key while changing its destination could disclose it to a new host.
        if token.is_none()
            && !clear
            && previous.as_ref().is_some_and(|p| {
                p.encrypted_secret.is_some()
                    && (p.settings.base_url != settings.base_url
                        || p.settings.provider_type != settings.provider_type)
            })
        {
            return Err(Error::Invalid(
                "주소 변경 시 API Key를 새로 입력하거나 삭제하세요.",
            ));
        }
        let config_id = Uuid::new_v4();
        let encrypted_secret = if let Some(token) = token {
            use secrecy::ExposeSecret;
            let token = SecretString::from(token);
            let value = token.expose_secret();
            validate_token(value)?;
            Some(self.secrets.encrypt(config_id, value)?)
        } else if clear {
            None
        } else if let Some(p) = previous {
            p.encrypted_secret
                .map(|value| {
                    use secrecy::ExposeSecret;
                    let token = self.secrets.decrypt(p.config_id, &value)?;
                    self.secrets.encrypt(config_id, token.expose_secret())
                })
                .transpose()?
        } else {
            None
        };
        let provider = Provider {
            id,
            config_id,
            version: expected + 1,
            settings,
            encrypted_secret,
            created_at: now(),
        };
        self.store.save(provider, expected).await
    }
    pub async fn credentials(&self, id: Uuid, expected: i64) -> Result<Credentials, Error> {
        let provider = self.get(id).await?;
        if provider.version != expected {
            return Err(Error::Conflict);
        }
        if !provider.settings.enabled {
            return Err(Error::Invalid(
                "비활성화된 연결입니다. 활성화한 뒤 테스트하세요.",
            ));
        }
        self.decrypt(provider)
    }
    pub async fn pinned_credentials(&self, config: Uuid) -> Result<Credentials, Error> {
        self.decrypt(self.store.config(config).await?)
    }
    fn decrypt(&self, provider: Provider) -> Result<Credentials, Error> {
        let token = provider
            .encrypted_secret
            .as_ref()
            .map(|value| self.secrets.decrypt(provider.config_id, value))
            .transpose()?;
        Ok(Credentials {
            connection_id: provider.id,
            config_id: provider.config_id,
            kind: provider.settings.provider_type,
            base_url: provider.settings.base_url,
            model_identifier: provider.settings.model_identifier,
            timeout_seconds: provider.settings.timeout_seconds,
            token,
        })
    }
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn normalize_base_url(value: &str) -> Result<String, Error> {
    let mut url = url::Url::parse(value.trim())
        .map_err(|_| Error::Invalid("올바른 HTTP 또는 HTTPS Base URL을 입력하세요."))?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::Invalid(
            "Base URL에는 HTTP(S) 주소만 입력하세요. 인증 정보·쿼리·fragment는 허용하지 않습니다.",
        ));
    }
    if url.as_str().len() > 2048 {
        return Err(Error::Invalid("Base URL이 너무 깁니다."));
    }
    url.set_path(&format!("{}/", url.path().trim_end_matches('/')));
    Ok(url.to_string())
}

fn validate_token(value: &str) -> Result<(), Error> {
    if value.is_empty() || value.len() > 4096 || !value.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(Error::Invalid(
            "API Key는 공백 없이 최대 4096자의 ASCII 값으로 입력하세요.",
        ));
    }
    Ok(())
}
