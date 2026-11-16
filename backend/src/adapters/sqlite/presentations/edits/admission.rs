// Purpose: Admit a chat edit against the current published slide and selected writing model.
// Pattern: Immutable input identity, bounded queue and idempotent command receipt.
// Usage: Explicit send from the right-side chat; no model execution on typing or tab visits.
// Related: lifecycle.rs, apply.rs, presentation_run_slides.
use super::*;
use sha2::{Digest, Sha256};
pub(in crate::adapters::sqlite::presentations) fn create(
    db: &mut rusqlite::Connection,
    p: Uuid,
    run: Uuid,
    slide: Uuid,
    key: Uuid,
    input: EditRequest,
    profile: String,
) -> Result<Edit, Error> {
    let tx = db.transaction().map_err(failure)?;
    preparation::project(&tx, p, true)?;
    let fingerprint = hex::encode(Sha256::digest(
        serde_json::to_vec(&(p, run, slide, &input)).map_err(|_| Error::Storage)?,
    ));
    if let Some((id, old)) = tx
        .query_row(
            "SELECT id,fingerprint FROM presentation_edits WHERE request_key=?",
            [key.to_string()],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(failure)?
    {
        if old != fingerprint {
            return Err(Error::Idempotency);
        }
        return get(&tx, p, &id);
    }
    let(deck,node,runtime):(String,String,String)=tx.query_row("SELECT r.presentation_id,s.node_id,r.runtime_profile FROM presentation_runs r JOIN presentations d ON d.id=r.presentation_id JOIN presentation_revisions v ON v.id=r.id JOIN presentation_run_slides x ON x.run_id=r.id JOIN presentation_slide_versions s ON s.id=x.slide_version_id WHERE r.id=? AND r.project_id=? AND s.id=? AND r.status='succeeded' AND d.current_revision_id=r.id AND d.version=?",params![run.to_string(),p.to_string(),slide.to_string(),input.expected_version],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(failure)?.ok_or(Error::Conflict)?;
    if runtime != profile {
        return Err(Error::Processing("runtime_changed"));
    }
    let busy:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM presentation_edits WHERE presentation_id=? AND (status IN('queued','running') OR (status='applying' AND applied_run_id IN(SELECT id FROM presentation_runs WHERE status IN('queued','running'))))) OR (SELECT count(*) FROM presentation_edits WHERE status IN('queued','running'))>=20",[&deck],|r|r.get(0)).map_err(failure)?;
    if busy {
        return Err(Error::Busy);
    }
    let config:Option<(String,String,i64,bool)>=tx.query_row("SELECT v.id,v.provider_type,v.version,v.enabled FROM llm_provider_connections c JOIN llm_provider_config_versions v ON v.id=c.current_config_version_id WHERE c.id=?",[input.connection_id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(failure)?;
    let (config, kind, version, enabled) = config.ok_or(Error::NotReady)?;
    let kind: crate::modules::model_registry::ProviderKind =
        kind.parse().map_err(|_| Error::Invalid)?;
    if kind.is_system() || !enabled || version != input.model_version {
        return Err(Error::Conflict);
    }
    let id = Uuid::new_v4();
    tx.execute("INSERT INTO presentation_edits(id,project_id,presentation_id,base_revision_id,base_version,source_slide_id,node_id,config_id,request_key,fingerprint,prompt,fields_json,definition_version,runtime_profile,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,'queued',?)",params![id.to_string(),p.to_string(),deck,run.to_string(),input.expected_version,slide.to_string(),node,config,key.to_string(),fingerprint,input.prompt,serde_json::to_string(&input.fields).map_err(|_|Error::Storage)?,profile,now()]).map_err(failure)?;
    let edit = get(&tx, p, &id.to_string())?;
    tx.commit().map_err(failure)?;
    Ok(edit)
}
