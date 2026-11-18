// Purpose: Combine indexed block matches with diverse project-document candidates.
// Pattern: Bounded candidate quotas, one extraction identity, and normalized provenance links.
// Usage: Creation transaction snapshots candidates before any model work.
// Related: context.rs, queries.rs, V1__baseline.sql.
use super::*;
use rusqlite::params;
use std::collections::BTreeSet;
// Every branch uses the same scope. Latest file versions are default; archived projects are explicit.
pub(super) const ELIGIBLE: &str = "SELECT p.id AS project_id,i.id AS item_id,v.id AS version_id,j.id AS job_id,j.extraction_id,v.created_at,f.original_filename,i.title FROM source_items i JOIN projects p ON p.id=i.project_id JOIN source_versions v ON v.item_id=i.id JOIN file_registrations f ON f.id=v.file_registration_id JOIN registered_file_facts b ON b.registration_id=f.id JOIN document_jobs j ON j.id=(SELECT id FROM document_jobs WHERE source_version_id=v.id AND extraction_id IS NOT NULL AND status IN('succeeded','waiting_configuration','classifying') ORDER BY generation DESC LIMIT 1) WHERE p.id!=?1 AND p.deleted_at IS NULL AND i.deleted_at IS NULL AND i.status='active' AND (?2 OR p.status='active') AND (?3 OR v.id=i.current_version_id) AND (?4 IS NULL OR p.id=?4) AND (?5 IS NULL OR b.format=?5) AND (?6 IS NULL OR v.created_at>=?6)";
pub(super) fn terms(query: &str) -> Vec<String> {
    let mut words = Vec::new();
    for w in query.split(|c: char| !c.is_alphanumeric()) {
        if w.chars().count() < 2 || w.len() > 80 {
            continue;
        }
        let w = w.to_lowercase();
        if !words.contains(&w) {
            words.push(w)
        }
        if words.len() == 8 {
            break;
        }
    }
    words
}
pub(super) fn fts_query(query: &str) -> String {
    terms(query)
        .iter()
        .map(|t| format!("\"{}\"*", t.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ")
}
pub(super) fn seed(
    db: &rusqlite::Transaction<'_>,
    run: Uuid,
    project: Uuid,
    input: &Search,
    snapshot: &context::Snapshot,
) -> Result<(), Error> {
    let o = &input.options;
    let eligible = eligible(o);
    let mut candidates = Vec::<(String, Option<String>, String)>::new();
    let mut seen = BTreeSet::new();
    let mut file_count = 0;
    let mut block_count = 0;
    let mut add = |extraction: String, block: Option<String>, excerpt: String| {
        let key = (extraction.clone(), block.clone());
        if (block.is_none() && file_count >= 24) || (block.is_some() && block_count >= 24) {
            return;
        }
        if seen.insert(key) && candidates.len() < 48 {
            if block.is_none() {
                file_count += 1;
            } else {
                block_count += 1;
            }
            candidates.push((extraction, block, excerpt));
        }
    };
    let phrase = if input.query.is_empty() {
        snapshot
            .sources
            .iter()
            .take(3)
            .map(|(_, id)| context::text(db, id, None, 600))
            .collect::<Result<Vec<_>, _>>()?
            .join(" ")
    } else {
        input.query.clone()
    };
    let fts = fts_query(&phrase);
    if !fts.is_empty() {
        let sql = fts_sql(o);
        let rows = db
            .prepare(&sql)
            .map_err(failure)?
            .query_map(
                params![
                    project.to_string(),
                    o.include_archived,
                    o.previous_versions,
                    o.source_project.map(|p| p.to_string()),
                    o.format,
                    o.since,
                    fts
                ],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .map_err(failure)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(failure)?;
        let mut matched_files = std::collections::BTreeMap::new();
        for (block, ext) in rows {
            if matched_files.len() < 12 {
                matched_files.entry(ext.clone()).or_insert(block.clone());
            }
            add(ext, Some(block.clone()), block);
        }
        for (ext, excerpt) in matched_files {
            add(ext.clone(), None, excerpt.clone());
            add(ext, Some(excerpt.clone()), excerpt);
        }
    }
    // File-title matches and a small per-project diversity quota prevent FTS from being the only gate.
    let sql = format!(
        "WITH eligible AS ({eligible}), grouped AS (SELECT extraction_id,project_id,max(created_at) AS created_at,max(instr(lower(original_filename||' '||title),lower(?7))) AS title_match FROM eligible GROUP BY extraction_id,project_id), ranked AS (SELECT *,row_number() OVER(PARTITION BY project_id ORDER BY title_match DESC,created_at DESC,extraction_id) AS n FROM grouped) SELECT extraction_id FROM ranked WHERE n<=2 OR (?7!='' AND title_match>0) GROUP BY extraction_id ORDER BY max(title_match) DESC,max(created_at) DESC,extraction_id LIMIT 24"
    );
    let files = db
        .prepare(&sql)
        .map_err(failure)?
        .query_map(
            params![
                project.to_string(),
                o.include_archived,
                o.previous_versions,
                o.source_project.map(|p| p.to_string()),
                o.format,
                o.since,
                input.query
            ],
            |r| r.get::<_, String>(0),
        )
        .map_err(failure)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(failure)?;
    for ext in files {
        let excerpt = first_excerpt(db, &ext)?;
        if let Some(excerpt) = excerpt {
            add(ext.clone(), None, excerpt.clone());
            add(ext, Some(excerpt.clone()), excerpt);
        }
    }
    for (position, (ext, block, excerpt)) in candidates.into_iter().enumerate() {
        let id = Uuid::new_v4().to_string();
        db.execute("INSERT INTO relation_candidates(id,run_id,ordinal,kind,extraction_id,block_id,excerpt_block_id) VALUES(?,?,?,?,?,?,?)",params![id,run.to_string(),position as i64,if block.is_some(){"block"}else{"file"},ext,block,excerpt]).map_err(failure)?;
    }
    let sql = format!(
        "WITH eligible AS ({eligible}) INSERT INTO relation_origins SELECT c.id,e.version_id,e.job_id FROM relation_candidates c JOIN eligible e ON e.extraction_id=c.extraction_id WHERE c.run_id=?7"
    );
    db.execute(
        &sql,
        params![
            project.to_string(),
            o.include_archived,
            o.previous_versions,
            o.source_project.map(|p| p.to_string()),
            o.format,
            o.since,
            run.to_string()
        ],
    )
    .map_err(failure)?;
    Ok(())
}

fn first_excerpt(db: &rusqlite::Connection, extraction: &str) -> Result<Option<String>, Error> {
    use rusqlite::OptionalExtension;
    for filter in [
        "b.kind NOT IN('image','heading','separator')",
        "b.kind!='image'",
    ] {
        let sql = format!(
            "SELECT (SELECT b.id FROM content_blocks b WHERE b.page_id=p.id AND {filter} ORDER BY b.position LIMIT 1) FROM document_pages p WHERE p.extraction_id=? AND EXISTS(SELECT 1 FROM content_blocks b WHERE b.page_id=p.id AND {filter}) ORDER BY p.ordinal LIMIT 1"
        );
        let value = db
            .query_row(&sql, [extraction], |r| r.get::<_, String>(0))
            .optional()
            .map_err(failure)?;
        if value.is_some() {
            return Ok(value);
        }
    }
    Ok(None)
}
fn eligible(o: &Options) -> String {
    ELIGIBLE
        .replace(
            "(?3 OR v.id=i.current_version_id)",
            if o.previous_versions {
                "1"
            } else {
                "v.id=i.current_version_id"
            },
        )
        .replace(
            "(?4 IS NULL OR p.id=?4)",
            if o.source_project.is_some() {
                "p.id=?4"
            } else {
                "1"
            },
        )
}
fn fts_sql(o: &Options) -> String {
    let eligible = eligible(o);
    format!(
        "WITH eligible AS MATERIALIZED ({eligible}) SELECT b.id,p.extraction_id FROM content_blocks_fts JOIN content_blocks b ON b.rowid=content_blocks_fts.rowid JOIN document_pages p ON p.id=b.page_id WHERE content_blocks_fts MATCH ?7 AND b.kind!='image' AND EXISTS(SELECT 1 FROM eligible e WHERE e.extraction_id=p.extraction_id) ORDER BY content_blocks_fts.rank LIMIT 16"
    )
}
#[cfg(test)]
mod tests;
