// Purpose: Resolve temporary model-discovery credentials without registering a model.
// Pattern: Reuse saved secrets only for the same version, provider and destination.
// Usage: Execution asks Registry for discovery credentials; nothing is persisted here.
// Related: mod.rs, model_execution/mod.rs, adapters/http/model_discovery.rs.
use super::{Credentials, Error, ProviderKind, Registry, normalize_base_url, validate_token};
use secrecy::SecretString;
use uuid::Uuid;
pub(crate) struct DiscoveryInput {
    pub connection_id: Option<Uuid>,
    pub expected_version: Option<i64>,
    pub kind: ProviderKind,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub clear_secret: bool,
}
impl Registry {
    pub async fn discovery_credentials(&self, input: DiscoveryInput) -> Result<Credentials, Error> {
        let previous = match (input.connection_id, input.expected_version) {
            (Some(id), Some(version)) => {
                let p = self.get(id).await?;
                if p.version != version {
                    return Err(Error::Conflict);
                }
                Some(p)
            }
            (None, None) => None,
            _ => return Err(Error::Invalid("조회할 연결과 설정 버전을 함께 지정하세요.")),
        };
        let address = input.base_url.as_deref().filter(|s| !s.trim().is_empty());
        let base_url = normalize_base_url(
            address
                .or_else(|| previous.as_ref().map(|p| p.settings.base_url.as_str()))
                .ok_or(Error::Invalid("모델 서버의 연결 주소를 입력하세요."))?,
        )?;
        if input.clear_secret && input.api_key.is_some() {
            return Err(Error::Invalid(
                "인증 정보 교체와 삭제를 동시에 요청할 수 없습니다.",
            ));
        }
        let token = if let Some(key) = input.api_key {
            validate_token(&key)?;
            Some(SecretString::from(key))
        } else if input.clear_secret {
            None
        } else if let Some(p) = &previous {
            if p.encrypted_secret.is_some()
                && (p.settings.base_url != base_url || p.settings.provider_type != input.kind)
            {
                return Err(Error::Invalid(
                    "주소 변경 시 API Key를 새로 입력하거나 삭제하세요.",
                ));
            }
            p.encrypted_secret
                .as_ref()
                .map(|key| self.secrets.decrypt(p.config_id, key))
                .transpose()?
        } else {
            None
        };
        Ok(Credentials {
            connection_id: previous.as_ref().map_or(Uuid::nil(), |p| p.id),
            config_id: previous.as_ref().map_or(Uuid::nil(), |p| p.config_id),
            kind: input.kind,
            base_url,
            token,
            model_identifier: String::new(),
            timeout_seconds: 30,
            max_output_tokens: None,
        })
    }
}
