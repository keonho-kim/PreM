// Purpose: Verify V5 provider settings, encrypted keys and request lineage survive current migrations.
// Pattern: Build a historical database with the real migration runner, then open current app.
// Usage: cargo nextest run --test provider_migration; all files stay in isolated QA storage.
// Related: migrations/V15__vllm_sr_provider.sql, adapters/filesystem/secrets.rs.
mod common;
use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305,
    aead::{Aead, Payload},
};
use prem_backend::app::Application;
use rusqlite::{Connection, params};
use uuid::Uuid;
mod embedded {
    refinery::embed_migrations!("migrations");
}
#[tokio::test]
async fn v5_provider_ids_ciphertext_and_history_are_preserved() {
    verify_migration(5).await;
}
#[tokio::test]
async fn v6_provider_ids_ciphertext_and_history_are_preserved() {
    verify_migration(6).await;
}
#[tokio::test]
async fn v14_provider_ids_ciphertext_and_history_are_preserved() {
    verify_migration(14).await;
}
async fn verify_migration(version: i32) {
    let root = common::storage();
    std::fs::create_dir_all(root.path().join("db")).unwrap();
    std::fs::create_dir_all(root.path().join("config")).unwrap();
    let path = root.path().join("db/app.sqlite");
    let mut db = Connection::open(&path).unwrap();
    embedded::migrations::runner()
        .set_target(refinery::Target::Version(version))
        .run(&mut db)
        .unwrap();
    let key = [19u8; 32];
    let nonce = [37u8; 24];
    let id = Uuid::new_v4();
    let revision = Uuid::new_v4();
    let request_id = Uuid::new_v4();
    let encrypted = XChaCha20Poly1305::new_from_slice(&key)
        .unwrap()
        .encrypt(
            (&nonce).into(),
            Payload {
                msg: b"historical-test-key",
                aad: revision.as_bytes(),
            },
        )
        .unwrap();
    let envelope = format!("v1:{}:{}", hex::encode(nonce), hex::encode(encrypted));
    std::fs::write(root.path().join("config/secret.key"), key).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            root.path().join("config/secret.key"),
            std::fs::Permissions::from_mode(0o600),
        )
        .unwrap();
    }
    db.execute(
        "INSERT INTO llm_provider_connections(id) VALUES (?)",
        params![id.to_string()],
    )
    .unwrap();
    db.execute("INSERT INTO llm_provider_config_versions VALUES (?,?,1,'Existing','lm_studio','http://127.0.0.1:1234/v1/','ornith-1.5-35b-a3b',180,1,?,1)",params![revision.to_string(),id.to_string(),envelope]).unwrap();
    db.execute(
        "INSERT INTO llm_requests VALUES (?,?,'text','succeeded',10,3,2,NULL,1)",
        params![request_id.to_string(), revision.to_string()],
    )
    .unwrap();
    db.execute(
        "UPDATE llm_provider_connections SET current_config_version_id=? WHERE id=?",
        params![revision.to_string(), id.to_string()],
    )
    .unwrap();
    if version == 14 {
        db.execute(
            "INSERT INTO projects(id,name,created_at,updated_at) VALUES (?,'Retained project',1,1)",
            [id.to_string()],
        )
        .unwrap();
        db.execute("INSERT INTO relation_runs(id,project_id,request_key,fingerprint,query,options_json,snapshot_hash,config_id,status,created_at,updated_at) VALUES (?,?,'retained','hash','','{}','snapshot',?,'succeeded',1,1)", params![request_id.to_string(),id.to_string(),revision.to_string()]).unwrap();
        db.execute(
            "UPDATE relation_settings SET connection_id=?,version=1",
            [id.to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO model_request_capacity VALUES (?,1,2,12,30)",
            [id.to_string()],
        )
        .unwrap();
    }
    drop(db);
    let app = Application::open(root.path()).unwrap();
    let (status, body) = common::request(
        &crate::common::router(&app),
        "GET",
        &format!("/api/v1/admin/llm/providers/{id}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["config_id"], revision.to_string());
    assert_eq!(body["provider_type"], "lm_studio");
    assert_eq!(body["has_secret"], true);
    app.shutdown().await.unwrap();
    let db = Connection::open(&path).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
            .unwrap(),
        33
    );
    assert_eq!(
        db.query_row(
            "SELECT encrypted_secret FROM llm_provider_config_versions WHERE id=?",
            [revision.to_string()],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        envelope
    );
    assert_eq!(
        db.query_row(
            "SELECT provider_config_version_id FROM llm_requests WHERE id=?",
            [request_id.to_string()],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        revision.to_string()
    );
    if version == 14 {
        assert_eq!(
            db.query_row(
                "SELECT config_id FROM relation_runs WHERE id=?",
                [request_id.to_string()],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            revision.to_string()
        );
        assert_eq!(
            db.query_row(
                "SELECT max_parallel FROM model_request_capacity WHERE connection_id=?",
                [id.to_string()],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            2
        );
        assert_eq!(
            db.query_row("SELECT connection_id FROM relation_settings", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            id.to_string()
        );
    }
    assert!(
        db.prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none()
    );
    let backup = std::fs::read_dir(root.path().join("backups"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(
        Connection::open(backup)
            .unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
            .unwrap(),
        version
    );
}
