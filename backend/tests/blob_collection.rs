// Purpose: Exercise retention, new references, backup pins and ambiguous-storage cleanup refusal.
// Pattern: Exclusive startup with synthetic disposable Blobs; no real application data touched.
// Usage: cargo nextest run --test blob_collection.
// Related: adapters/sqlite/collection.rs, adapters/filesystem/collection.rs.
#[allow(dead_code)]
mod common;
use puputyx_backend::app::Application;
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
fn database(root: &Path) -> Connection {
    Connection::open(root.join("db/app.sqlite")).unwrap()
}
fn blob(root: &Path, bytes: &[u8], registered: bool) -> (String, PathBuf) {
    let hash = hex::encode(Sha256::digest(bytes));
    let path = root
        .join("blobs/sha256")
        .join(&hash[..2])
        .join(&hash[2..4])
        .join(&hash);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, bytes).unwrap();
    if registered {
        database(root)
            .execute(
                "INSERT INTO file_blobs VALUES(?,?,'application/octet-stream','bin',1)",
                params![hash, bytes.len() as i64],
            )
            .unwrap();
    }
    (hash, path)
}
async fn restart(root: &Path) {
    Application::open(root).unwrap().shutdown().await.unwrap();
}
#[tokio::test]
async fn only_expired_unreferenced_bytes_are_collected() {
    let root = common::storage();
    restart(root.path()).await;
    let (a, pa) = blob(root.path(), b"unregistered abandoned bytes", false);
    let (b, pb) = blob(root.path(), b"registered unused bytes", true);
    let (c, pc) = blob(root.path(), b"later referenced original", true);
    restart(root.path()).await;
    assert!(
        pa.exists() && pb.exists() && pc.exists(),
        "first observation never deletes"
    );
    let db = database(root.path());
    assert_eq!(
        db.query_row("SELECT count(*) FROM blob_collection_candidates", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        3
    );
    db.execute("UPDATE blob_collection_candidates SET first_seen_at=1", [])
        .unwrap();
    db.execute(
        "INSERT INTO file_registrations VALUES('retained',?,'original.bin',1)",
        [&c],
    )
    .unwrap();
    drop(db);
    restart(root.path()).await;
    assert!(!pa.exists() && !pb.exists());
    assert!(pc.exists());
    let db = database(root.path());
    for h in [&a, &b] {
        assert_eq!(
            db.query_row("SELECT count(*) FROM file_blobs WHERE sha256=?", [h], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    assert_eq!(
        db.query_row("SELECT count(*) FROM blob_collection_candidates", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
#[tokio::test]
async fn backup_references_and_corrupt_backups_prevent_deletion() {
    let root = common::storage();
    restart(root.path()).await;
    let (hash, path) = blob(root.path(), b"snapshot retained bytes", true);
    restart(root.path()).await;
    let db = database(root.path());
    db.execute("UPDATE blob_collection_candidates SET first_seen_at=1", [])
        .unwrap();
    db.backup(
        rusqlite::MAIN_DB,
        root.path().join("backups/snapshot.sqlite"),
        None::<fn(rusqlite::backup::Progress)>,
    )
    .unwrap();
    db.execute("DELETE FROM file_blobs WHERE sha256=?", [&hash])
        .unwrap();
    drop(db);
    restart(root.path()).await;
    assert!(path.exists());
    let (_, orphan) = blob(root.path(), b"orphan during damaged backup", false);
    restart(root.path()).await;
    database(root.path())
        .execute("UPDATE blob_collection_candidates SET first_seen_at=1", [])
        .unwrap();
    std::fs::write(root.path().join("backups/broken.sqlite"), b"broken").unwrap();
    restart(root.path()).await;
    assert!(orphan.exists());
}
#[cfg(unix)]
#[tokio::test]
async fn unexpected_symlink_cannot_be_followed_by_collection() {
    let root = common::storage();
    restart(root.path()).await;
    let (_, path) = blob(root.path(), b"must retain on uncertain layout", false);
    restart(root.path()).await;
    database(root.path())
        .execute("UPDATE blob_collection_candidates SET first_seen_at=1", [])
        .unwrap();
    let outside = common::storage();
    std::fs::write(outside.path().join("precious"), b"keep").unwrap();
    let link = root.path().join("blobs/sha256/zz");
    std::os::unix::fs::symlink(outside.path(), &link).unwrap();
    restart(root.path()).await;
    assert!(path.exists());
    assert_eq!(
        std::fs::read(outside.path().join("precious")).unwrap(),
        b"keep"
    );
}
