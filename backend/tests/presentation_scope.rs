// Purpose: Verify selected outline branches produce only their pinned, ordered slide scope.
// Pattern: Real HTTP/storage/rendering with bounded synthetic model responses and restart checks.
// Usage: cargo nextest run --test presentation_scope.
// Related: selection.rs, scope.rs, presentation_support/, presentations.rs.
mod common;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod presentation_support;
#[allow(dead_code)]
mod space_support;
use common::{request, router};
use outline_support::*;
use prem_backend::app::Application;
use presentation_support::*;
use serde_json::json;
use std::sync::atomic::Ordering;
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn selected_nodes_are_isolated_ordered_idempotent_and_survive_restart() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    let path = format!("/api/v1/projects/{p}/presentations");
    let scope_path = format!(
        "/api/v1/projects/{p}/presentation-preparation/sections?design_id={}",
        design["design_id"].as_str().unwrap()
    );
    let (s, scope) = request(&router(&app), "GET", &scope_path, None, None).await;
    assert_eq!(s, 200, "{scope}");
    let sections = scope["sections"].as_array().unwrap();
    assert_eq!(sections.len(), 3);
    let mut input = input(&design, &c);
    input["node_ids"] = json!([sections[2]["id"]]);
    let key = Uuid::new_v4().to_string();
    let (s, queued) = request(
        &router(&app),
        "POST",
        &path,
        Some(input.clone()),
        Some(&key),
    )
    .await;
    assert_eq!(s, 202, "{queued}");
    let done = wait_run(&app, &p, "succeeded").await;
    assert_eq!(done["total"], 1);
    let id = done["id"].as_str().unwrap();
    let (_, slides) = request(
        &router(&app),
        "GET",
        &format!("{path}/{id}/slides"),
        None,
        None,
    )
    .await;
    assert_eq!(slides.as_array().unwrap().len(), 1);
    assert_eq!(slides[0]["spec"]["title"], sections[2]["title"]);
    assert_eq!(f.model.slides.load(Ordering::SeqCst), 1);
    let (s, replay) = request(
        &router(&app),
        "POST",
        &path,
        Some(input.clone()),
        Some(&key),
    )
    .await;
    assert_eq!(s, 202);
    assert_eq!(replay["id"], done["id"]);
    input["node_ids"] = json!([sections[0]["id"]]);
    assert_eq!(
        request(
            &router(&app),
            "POST",
            &path,
            Some(input.clone()),
            Some(&key)
        )
        .await
        .0,
        409
    );
    for ids in [
        json!([]),
        json!([Uuid::new_v4()]),
        json!([sections[1]["id"], sections[1]["id"]]),
    ] {
        input["node_ids"] = ids;
        let (s, _) = request(
            &router(&app),
            "POST",
            &path,
            Some(input.clone()),
            Some(&Uuid::new_v4().to_string()),
        )
        .await;
        assert_eq!(s, 422);
    }
    input["node_ids"] = json!([sections[0]["id"], sections[1]["id"]]);
    let (s, _) = request(
        &router(&app),
        "POST",
        &path,
        Some(input.clone()),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202);
    let both = wait_run(&app, &p, "succeeded").await;
    assert_eq!(both["total"], 2);
    let (_, ordered) = request(
        &router(&app),
        "GET",
        &format!("{path}/{}/slides", both["id"].as_str().unwrap()),
        None,
        None,
    )
    .await;
    assert_eq!(ordered[0]["spec"]["title"], sections[1]["title"]);
    assert_eq!(ordered[1]["spec"]["title"], sections[2]["title"]);
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    let pinned: String = db
        .query_row(
            "SELECT node_id FROM presentation_slide_versions WHERE run_id=?",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pinned, sections[2]["id"].as_str().unwrap());
    let (_, old) = request(
        &router(&app),
        "GET",
        &format!("{path}/{id}/slides"),
        None,
        None,
    )
    .await;
    assert_eq!(old, slides);
    assert_eq!(f.model.slides.load(Ordering::SeqCst), 3);
    app.shutdown().await.unwrap();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (_, restored) = request(
        &router(&app),
        "GET",
        &format!("{path}/{id}/slides"),
        None,
        None,
    )
    .await;
    assert_eq!(restored, slides);
    // Editing from generation creates a reviewed outline/design, preserving old slides.
    let (_, current) = request(
        &router(&app),
        "GET",
        &format!("/api/v1/projects/{p}/outline"),
        None,
        None,
    )
    .await;
    let mut draft = current["draft"].clone();
    draft["nodes"][0]["title"] = json!("수정한 대목차");
    let child = Uuid::new_v4();
    let parent = draft["nodes"][0]["id"].clone();
    draft["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":child,"parent_id":parent,"title":"추가한 중목차","description":""}));
    let source = draft["assignments"][0]["block_id"].clone();
    draft["assignments"]
        .as_array_mut()
        .unwrap()
        .push(json!({"node_id":child,"block_id":source}));
    let edit = json!({"outline":{"expected_version":current["version"],"source_snapshot":current["source_snapshot"],"guide_version":current["guide_version"],"draft":draft},"template_job_id":null,"expected_design_version":design["version"]});
    let endpoint = format!("/api/v1/projects/{p}/outline-for-presentation");
    let (status, edited) = request(&router(&app), "PUT", &endpoint, Some(edit.clone()), None).await;
    assert_eq!(status, 200, "{edited}");
    assert_eq!(edited["ready"], true);
    assert!(edited["design_id"].is_string());
    let (status, replayed) =
        request(&router(&app), "PUT", &endpoint, Some(edit.clone()), None).await;
    assert_eq!(status, 200, "{replayed}");
    assert_eq!(replayed["design_id"], edited["design_id"]);
    let mut conflicting = edit;
    conflicting["outline"]["draft"]["nodes"][0]["title"] = json!("오래된 변경");
    assert_eq!(
        request(&router(&app), "PUT", &endpoint, Some(conflicting), None)
            .await
            .0,
        409
    );
    assert_eq!(f.model.slides.load(Ordering::SeqCst), 3);
    let (s, _) = request(
        &router(&app),
        "PUT",
        &format!("/api/v1/projects/{p}/guide"),
        Some(json!({"expected_version":1,"do_text":"새 방향","dont_text":""})),
        None,
    )
    .await;
    assert_eq!(s, 200);
    assert_eq!(
        request(&router(&app), "GET", &scope_path, None, None)
            .await
            .0,
        409
    );
    assert!(
        !request(
            &router(&app),
            "POST",
            &path,
            Some(input),
            Some(&Uuid::new_v4().to_string())
        )
        .await
        .0
        .is_success()
    );
    assert_eq!(f.model.slides.load(Ordering::SeqCst), 3);
    app.shutdown().await.unwrap();
}
