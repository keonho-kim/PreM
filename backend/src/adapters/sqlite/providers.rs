// Purpose: Commit immutable provider configurations and advance a conditional pointer.
// Pattern: Short transactions on the shared async SQLite writer.
// Usage: Registry persistence port; no network work occurs inside these transactions.
// Related: V1__baseline.sql, modules/model_registry/.
use super::{Queue, Unavailable};
use crate::modules::model_registry::{Error, Provider, ProviderStore, Settings, StoreFuture};
use rusqlite::{Connection, OptionalExtension, params};
use std::sync::Arc;
use uuid::Uuid;
pub(super) struct SqliteProviders(pub Arc<Queue>);
impl From<Unavailable> for Error {
    fn from(_: Unavailable) -> Self {
        Self::Unavailable
    }
}
fn failure(error: rusqlite::Error) -> Error {
    tracing::error!(%error,"provider storage failed");
    Error::Unavailable
}
const COLUMNS: &str = "c.connection_id,c.id,c.version,c.name,c.provider_type,c.base_url,c.model_identifier,c.timeout_seconds,c.enabled,c.encrypted_secret,c.created_at,c.max_output_tokens,c.context_length,c.physical_batch_size,(SELECT enabled FROM provider_thinking WHERE config_id=c.id),(SELECT effort FROM provider_thinking WHERE config_id=c.id)";
fn select() -> String {
    format!(
        "SELECT {COLUMNS} FROM llm_provider_config_versions c JOIN llm_provider_connections p ON p.current_config_version_id=c.id"
    )
}
fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Provider> {
    let uuid = |i| {
        let s: String = r.get(i)?;
        Uuid::parse_str(&s).map_err(|_| rusqlite::Error::InvalidQuery)
    };
    Ok(Provider {
        id: uuid(0)?,
        config_id: uuid(1)?,
        version: r.get(2)?,
        settings: Settings {
            name: r.get(3)?,
            provider_type: r
                .get::<_, String>(4)?
                .parse()
                .map_err(|_| rusqlite::Error::InvalidQuery)?,
            base_url: r.get(5)?,
            model_identifier: r.get(6)?,
            timeout_seconds: r.get(7)?,
            max_output_tokens: r.get(11)?,
            context_length: r.get(12)?,
            physical_batch_size: r.get(13)?,
            thinking: crate::modules::model_registry::Thinking {
                enabled: r.get(14)?,
                effort: r
                    .get::<_, Option<String>>(15)?
                    .map(|s| {
                        crate::modules::model_registry::Effort::parse(&s)
                            .ok_or(rusqlite::Error::InvalidQuery)
                    })
                    .transpose()?,
            },
            enabled: r.get(8)?,
        },
        encrypted_secret: r.get(9)?,
        created_at: r.get(10)?,
    })
}
fn get(db: &Connection, id: Uuid) -> Result<Provider, Error> {
    db.query_row(&format!("{} WHERE p.id=?", select()), [id.to_string()], row)
        .optional()
        .map_err(failure)?
        .ok_or(Error::NotFound)
}
impl ProviderStore for SqliteProviders {
    fn certify(
        &self,
        id: Uuid,
        hash: String,
        effort: Option<crate::modules::model_registry::Effort>,
    ) -> StoreFuture<Uuid> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
            let tx = db.transaction().map_err(failure)?;
            tx.execute("DELETE FROM provider_diagnostics WHERE expires_at <= unixepoch()",[]).map_err(failure)?;
            tx.execute("DELETE FROM provider_diagnostics WHERE token IN (SELECT token FROM provider_diagnostics ORDER BY expires_at DESC,rowid DESC LIMIT -1 OFFSET 255)",[]).map_err(failure)?;
            let token = Uuid::new_v4();
            tx.execute("INSERT INTO provider_diagnostics VALUES(?,?,?,?,unixepoch()+900)",params![token.to_string(),id.to_string(),hash,effort.map(|e|e.as_str())]).map_err(failure)?;
            tx.commit().map_err(failure)?;
            Ok(token)
        }).await
        })
    }
    fn certified_effort(
        &self,
        id: Uuid,
        token: Uuid,
        hash: String,
    ) -> StoreFuture<Option<crate::modules::model_registry::Effort>> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
            let value: Option<String> = db.query_row("SELECT effective_effort FROM provider_diagnostics WHERE token=? AND connection_id=? AND draft_hash=? AND expires_at>unixepoch()",params![token.to_string(),id.to_string(),hash],|r|r.get(0)).optional().map_err(failure)?
                .ok_or(Error::Invalid("설정이 바뀌었거나 진단이 만료되었습니다. 연결 진단을 다시 실행하세요."))?;
            Ok(value.as_deref().and_then(crate::modules::model_registry::Effort::parse))
        }).await
        })
    }
    fn setup(&self) -> StoreFuture<crate::modules::model_registry::ModelSetup> {
        let queue = self.0.clone();
        Box::pin(async move {
            queue
                .call(|db| {
                    let tx = db.transaction().map_err(failure)?;
                    let selected = tx
                        .query_row(
                            "SELECT connection_id FROM decision_settings WHERE id=1",
                            [],
                            |r| r.get(0),
                        )
                        .map_err(failure)?;
                    let llm = super::writing_model::resolve(&tx, None, None)
                        .map_err(failure)?
                        .is_some();
                    let decision = super::decision_settings::resolve(&tx, selected)
                        .map_err(failure)?
                        .is_some();
                    tx.commit().map_err(failure)?;
                    Ok(crate::modules::model_registry::ModelSetup { llm, decision })
                })
                .await
        })
    }
    fn list(&self) -> StoreFuture<Vec<Provider>> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(|db| {
                db.prepare(&format!("{} ORDER BY c.name,p.id", select()))
                    .map_err(failure)?
                    .query_map([], row)
                    .map_err(failure)?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(failure)
            })
            .await
        })
    }
    fn get(&self, id: Uuid) -> StoreFuture<Provider> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| get(db, id)).await })
    }
    fn config(&self, id: Uuid) -> StoreFuture<Provider> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
                db.query_row(
                    &format!("SELECT {COLUMNS} FROM llm_provider_config_versions c WHERE c.id=?"),
                    [id.to_string()],
                    row,
                )
                .optional()
                .map_err(failure)?
                .ok_or(Error::NotFound)
            })
            .await
        })
    }
    fn save(&self, p: Provider, expected: i64) -> StoreFuture<Provider> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move|db| {
    let tx=db.transaction().map_err(failure)?;
    let version:Option<i64>=tx.query_row("SELECT c.version FROM llm_provider_connections p JOIN llm_provider_config_versions c ON c.id=p.current_config_version_id WHERE p.id=?",[p.id.to_string()],|r|r.get(0)).optional().map_err(failure)?;
    if version.unwrap_or(0)!=expected {return Err(Error::Conflict);}
    if expected==0 {tx.execute("INSERT INTO llm_provider_connections(id) VALUES (?)",[p.id.to_string()]).map_err(failure)?;}
    let s=&p.settings;
    tx.execute("INSERT INTO llm_provider_config_versions(id,connection_id,version,name,provider_type,base_url,model_identifier,timeout_seconds,enabled,encrypted_secret,created_at,max_output_tokens,context_length,physical_batch_size) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",params![p.config_id.to_string(),p.id.to_string(),p.version,s.name,s.provider_type.as_str(),s.base_url,s.model_identifier,s.timeout_seconds,s.enabled,p.encrypted_secret,p.created_at,s.max_output_tokens,s.context_length,s.physical_batch_size]).map_err(failure)?;
    if let Some(enabled) = s.thinking.enabled {
        tx.execute("INSERT INTO provider_thinking(config_id,enabled,effort) VALUES(?,?,?)",
            params![p.config_id.to_string(),enabled,s.thinking.effort.map(|v|v.as_str())]).map_err(failure)?;
    }
    tx.execute("UPDATE llm_provider_connections SET current_config_version_id=? WHERE id=?",params![p.config_id.to_string(),p.id.to_string()]).map_err(failure)?;
    tx.execute("DELETE FROM provider_diagnostics WHERE connection_id=?",[p.id.to_string()]).map_err(failure)?;
    tx.commit().map_err(failure)?; Ok(p)
 }).await
        })
    }
}
