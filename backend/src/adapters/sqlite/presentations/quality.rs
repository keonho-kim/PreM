// Purpose: Persist project-scoped render cache entries and fenced per-slide quality outcomes.
// Pattern: One write owner, short transactions and bounded LRU derived cache; originals stay intact.
// Usage: Presentation quality consumer; successful checkpoints survive render/assembly retry.
// Related: modules/presentations/quality.rs, V29 migration, jobs.rs, edits/mod.rs.
use super::*;
use crate::modules::assets::DerivedFormat;
impl QualityStore for SqlitePresentations {
    fn render_style(&self, p: Uuid, key: String) -> Work<Option<Typography>> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
            preparation::project(db,p,true)?;
            let json:Option<String>=db.query_row("SELECT report_json FROM presentation_quality_checks WHERE project_id=? AND style_key=? AND passed=1 ORDER BY rowid DESC LIMIT 1",params![p.to_string(),key],|r|r.get(0)).optional().map_err(failure)?;
            json.map(|s|serde_json::from_str::<QualityReport>(&s).map(|r|r.typography).map_err(|_|Error::Storage)).transpose().map(Option::flatten)
        }).await
        })
    }

    fn render_policy(&self, r: Run) -> Work<bool> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
            jobs::active(db, &r)?;
            db.query_row("SELECT manual_design_id IS NULL AND base_version=0 AND NOT EXISTS(SELECT 1 FROM presentation_restorations WHERE run_id=r.id) FROM presentation_runs r WHERE r.id=?", [r.id.to_string()], |r| r.get(0)).map_err(failure)
        }).await
        })
    }
    fn cached_slide(&self, p: Uuid, key: String) -> Work<Option<CachedSlide>> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
            preparation::project(db, p, true)?;
            let row = db.query_row("SELECT c.output_sha256,o.size_bytes,c.preview_sha256,p.size_bytes,c.report_json FROM presentation_render_cache c JOIN file_blobs o ON o.sha256=c.output_sha256 JOIN file_blobs p ON p.sha256=c.preview_sha256 WHERE c.project_id=? AND c.cache_key=?", params![p.to_string(),key], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?,r.get::<_,String>(4)?))).optional().map_err(failure)?;
            row.map(|(output, os, preview, ps, report)| {
                db.execute("UPDATE presentation_render_cache SET last_used_at=? WHERE project_id=? AND cache_key=?", params![now(),p.to_string(),key]).map_err(failure)?;
                Ok(CachedSlide { layers:layers::read(db,p,&key)?, output: DerivedBlob{sha256:output,size:os.try_into().map_err(|_|Error::Storage)?,format:DerivedFormat::Binary}, preview: DerivedBlob{sha256:preview,size:ps.try_into().map_err(|_|Error::Storage)?,format:DerivedFormat::Png}, report:serde_json::from_str(&report).map_err(|_|Error::Storage)? })
            }).transpose()
        }).await
        })
    }
    fn check_slide(&self, check: SlideCheck) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| save(db, check)).await })
    }
}
fn save(db: &mut rusqlite::Connection, c: SlideCheck) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    let s = &c.scope;
    let slides = if s.editing {
        let mut e = edits::get(&tx, s.project_id, &s.job_id.to_string())?;
        e.lease = Some(s.lease.clone());
        edits::render_source(&tx, e)?.0
    } else {
        let mut r = queries::run(&tx, s.project_id, &s.job_id.to_string())?;
        r.lease = Some(s.lease.clone());
        jobs::active(&tx, &r)?;
        queries::slides(&tx, s.project_id, s.job_id)?
    };
    if !slides
        .iter()
        .any(|s| s.id == c.slide_id && s.position == c.position)
    {
        return Err(Error::Conflict);
    }
    let running:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM workflow_nodes WHERE workflow_id=? AND node_key='render' AND state='running' AND lease=?)", params![s.workflow(),s.lease],|r|r.get(0)).map_err(failure)?;
    if !running {
        return Err(Error::Cancelled);
    }
    if c.report.schema_version != 1
        || c.report.repair_attempts > 2
        || c.report.issues.len() > 64
        || c.report.passed != c.rendered.is_some()
    {
        return Err(Error::Storage);
    }
    let report = serde_json::to_string(&c.report).map_err(|_| Error::Storage)?;
    if let Some(out) = c.rendered {
        plans::blob(
            &tx,
            &out.output,
            crate::modules::assets::Format::Pptx.mime(),
            "pptx",
        )?;
        plans::blob(&tx, &out.preview, "image/png", "png")?;
        tx.execute("INSERT INTO presentation_render_cache VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,cache_key) DO UPDATE SET output_sha256=excluded.output_sha256,preview_sha256=excluded.preview_sha256,report_json=excluded.report_json,last_used_at=excluded.last_used_at", params![s.project_id.to_string(),c.key,out.output.sha256,out.preview.sha256,report,now()]).map_err(failure)?;
        layers::save(&tx, s.project_id, &c.key, &out.layers)?;
        tx.execute("DELETE FROM presentation_render_cache WHERE project_id=?1 AND cache_key IN(SELECT cache_key FROM(SELECT c.cache_key,row_number() OVER(ORDER BY c.last_used_at DESC,c.cache_key) AS n,sum(o.size_bytes+p.size_bytes+coalesce((SELECT sum(b.size_bytes) FROM presentation_render_layers l JOIN file_blobs b ON b.sha256=l.blob_sha256 WHERE l.project_id=c.project_id AND l.cache_key=c.cache_key),0)) OVER(ORDER BY c.last_used_at DESC,c.cache_key) AS bytes FROM presentation_render_cache c JOIN file_blobs o ON o.sha256=c.output_sha256 JOIN file_blobs p ON p.sha256=c.preview_sha256 WHERE c.project_id=?1) WHERE n>512 OR bytes>536870912)", [s.project_id.to_string()]).map_err(failure)?;
    }
    tx.execute("INSERT INTO presentation_quality_checks(workflow_id,project_id,style_key,slide_version_id,position,passed,report_json,reused,cache_key) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(workflow_id,slide_version_id) DO UPDATE SET passed=excluded.passed,report_json=excluded.report_json,reused=excluded.reused,cache_key=excluded.cache_key",params![s.workflow(),s.project_id.to_string(),c.style_key,c.slide_id.to_string(),c.position,c.report.passed,report,c.reused,c.key]).map_err(failure)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
pub(super) fn read(db: &rusqlite::Connection, workflow: &str) -> Result<Vec<SlideQuality>, Error> {
    let rows=db.prepare("SELECT position,report_json,reused FROM presentation_quality_checks WHERE workflow_id=? ORDER BY position").map_err(failure)?.query_map([workflow],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,bool>(2)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    rows.into_iter()
        .map(|(position, json, reused)| {
            Ok(SlideQuality {
                position,
                report: serde_json::from_str(&json).map_err(|_| Error::Storage)?,
                reused,
            })
        })
        .collect()
}
