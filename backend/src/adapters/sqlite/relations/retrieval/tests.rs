// Purpose: Measure the actual candidate query against a synthetic 10,000-block corpus.
// Pattern: In-memory migrated SQLite, real FTS triggers and query-plan inspection; no model calls.
// Usage: cargo nextest includes this bounded retrieval benchmark.
// Related: retrieval.rs, tests/.artifacts/relations-query-benchmark.json.
use super::*;
mod embedded {
    refinery::embed_migrations!("migrations");
}
#[test]
fn fts_candidates_use_the_index_without_copying_the_corpus() {
    let mut db = rusqlite::Connection::open_in_memory().unwrap();
    embedded::migrations::runner()
        .set_grouped(true)
        .run(&mut db)
        .unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    let target = Uuid::new_v4();
    let other = Uuid::new_v4();
    db.execute(
        "INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,'Target',1,1)",
        [target.to_string()],
    )
    .unwrap();
    db.execute(
        "INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,'Past',1,1)",
        [other.to_string()],
    )
    .unwrap();
    db.execute_batch("INSERT INTO file_blobs VALUES('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,'text/html','html',1); INSERT INTO file_registrations VALUES('registration','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','report.html',1);").unwrap();
    db.execute("INSERT INTO source_items(id,project_id,title,created_at,updated_at) VALUES('item',?,'Report',1,1)",[other.to_string()]).unwrap();
    db.execute_batch("INSERT INTO source_versions VALUES('version','item',1,'registration',1); UPDATE source_items SET current_version_id='version'; INSERT INTO document_extractions VALUES('extraction','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','profile',2,'unpaginated','[]',1); INSERT INTO document_pages VALUES('page','extraction',1,NULL,'본문',NULL); UPDATE document_jobs SET profile='profile',status='succeeded',extraction_id='extraction';").unwrap();
    let tx = db.transaction().unwrap();
    for i in 0..10000 {
        tx.execute("INSERT INTO content_blocks VALUES(?,?,?,'paragraph',?,'{}',NULL)",params![format!("block-{i}"),"page",i,format!("Business efficiency optimization evidence and operational improvement scenario {i}")]).unwrap();
    }
    tx.commit().unwrap();
    let plan = db
        .prepare(&format!(
            "EXPLAIN QUERY PLAN {}",
            fts_sql(&Options::default())
        ))
        .unwrap()
        .query_map(
            params![
                target.to_string(),
                true,
                false,
                Option::<String>::None,
                Option::<String>::None,
                Option::<i64>::None,
                "\"efficiency\"*"
            ],
            |r| r.get::<_, String>(3),
        )
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(
        plan.iter().any(|s| s.contains("VIRTUAL TABLE INDEX")),
        "{plan:?}"
    );
    let before: i64 = db.query_row("PRAGMA page_count", [], |r| r.get(0)).unwrap();
    let mut durations = Vec::new();
    for _ in 0..20 {
        let run = Uuid::new_v4();
        let tx = db.transaction().unwrap();
        tx.execute("INSERT INTO relation_runs(id,project_id,request_key,fingerprint,query,options_json,snapshot_hash,status,created_at,updated_at) VALUES(?,?,?,'fixture','efficiency','{}','fixture','waiting_configuration',1,1)",params![run.to_string(),target.to_string(),Uuid::new_v4().to_string()]).unwrap();
        let start = std::time::Instant::now();
        seed(
            &tx,
            run,
            target,
            &Search {
                query: "efficiency".into(),
                options: Options {
                    include_archived: true,
                    ..Default::default()
                },
            },
            &context::Snapshot {
                sources: vec![],
                guide: None,
                hash: String::new(),
            },
        )
        .unwrap();
        durations.push(start.elapsed().as_secs_f64() * 1000.0);
        tx.commit().unwrap();
    }
    durations.sort_by(f64::total_cmp);
    assert!(
        durations[19] < 2000.0,
        "bounded retrieval took too long: {durations:?}"
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM content_blocks", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        10000
    );
    let after: i64 = db.query_row("PRAGMA page_count", [], |r| r.get(0)).unwrap();
    let size: i64 = db.query_row("PRAGMA page_size", [], |r| r.get(0)).unwrap();
    let report = serde_json::json!({"fixture_blocks":10000,"searches":20,"candidate_query_p50_ms":durations[10],"candidate_query_p95_ms":durations[18],"candidate_query_max_ms":durations[19],"metadata_growth_bytes":(after-before)*size,"document_blocks_after":10000,"query_plan":plan});
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/.artifacts");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("relations-query-benchmark.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
}
