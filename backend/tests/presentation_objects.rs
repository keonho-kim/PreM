// Purpose: Verify real native objects, immutable media, batch publication and scoped object edits.
// Pattern: Isolated application and deterministic model with real PPTX rendering/ZIP inspection.
// Usage: cargo nextest run --test presentation_objects; no production data or remote model.
// Related: V21 migration, outline_support/edit.rs, presentation_support/.
mod common;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod presentation_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use outline_support::*;
use prem_backend::app::Application;
use presentation_support::edits::*;
use presentation_support::*;
use serde_json::json;
use std::sync::atomic::Ordering;
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn images_native_charts_batch_and_selected_objects_survive_publication_and_restart() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    let (s, v) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(input(&design, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202, "{v}");
    let first = wait_run(&app, &p, "succeeded").await;
    let before = slides(&app, &p, &first).await;
    let image = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/documents/scan.png"),
    )
    .unwrap();
    let key = Uuid::new_v4().to_string();
    let (s, media) = upload(&app, &p, &key, image.clone()).await;
    assert_eq!(s, 201, "{media}");
    assert_eq!(upload(&app, &p, &key, image).await.1["id"], media["id"]);
    assert_eq!(
        upload(
            &app,
            &p,
            &Uuid::new_v4().to_string(),
            b"<svg><script>bad()</script></svg>".to_vec()
        )
        .await
        .0,
        422
    );
    let req = json!({"expected_version":first["presentation_version"],"connection_id":c,"model_version":1,"prompt":"두 장표에 실적 A 10, B 20 차트와 등록 이미지, 사각형을 추가하고 배치해 주세요.","fields":["objects","layout"],"slide_ids":before.as_array().unwrap().iter().map(|s|s["id"].clone()).collect::<Vec<_>>()});
    let path = thread(&p, &first, &before);
    let calls = f.model.calls.load(Ordering::SeqCst);
    let (s, v) = request(
        &app.router(),
        "POST",
        &path,
        Some(req),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202, "{v}");
    let edit = proposal(&app, &path, "ready").await;
    assert_eq!(edit["slides"].as_array().unwrap().len(), 2);
    assert_eq!(f.model.calls.load(Ordering::SeqCst) - calls, 2);
    assert_eq!(slides(&app, &p, &first).await, before);
    command(&app, &p, &edit, "apply").await;
    let second = wait_run(&app, &p, "succeeded").await;
    assert_eq!(second["presentation_version"], 2);
    let with_objects = slides(&app, &p, &second).await;
    for i in 0..2 {
        assert_eq!(with_objects[i]["spec"]["schema_version"], 2);
        assert_eq!(
            with_objects[i]["spec"]["objects"].as_array().unwrap().len(),
            3
        );
        assert_eq!(
            with_objects[i]["spec"]["bullets"],
            before[i]["spec"]["bullets"]
        );
    }
    let mut zip = output(&app, &p, &second).await;
    assert!(xml(&mut zip, "ppt/slides/slide1.xml").contains("PreM:chart-1"));
    assert!(xml(&mut zip, "ppt/slides/slide2.xml").contains("PreM:image-1"));
    let charts: Vec<_> = zip
        .file_names()
        .map(Result::unwrap)
        .filter(|n| n.starts_with("ppt/charts/chart") && n.ends_with(".xml"))
        .map(|s| s.into_owned())
        .collect();
    assert_eq!(charts.len(), 2);
    for file in charts {
        let x = xml(&mut zip, &file);
        assert!(x.contains("barChart"));
        let mut reader = quick_xml::Reader::from_str(&x);
        let mut values = vec![];
        loop {
            match reader.read_event().unwrap() {
                quick_xml::events::Event::Start(e) if e.name().as_ref() == "c:v" => {
                    if let Ok(v) = reader.read_text(e.name()).unwrap().parse::<f64>() {
                        values.push(v)
                    }
                }
                quick_xml::events::Event::Eof => break,
                _ => {}
            }
        }
        assert!(values.contains(&10.) && values.contains(&20.));
    }
    assert!(
        zip.file_names()
            .map(Result::unwrap)
            .any(|n| n.starts_with("ppt/embeddings/") && n.ends_with(".xlsx"))
    );
    assert!(
        zip.file_names()
            .map(Result::unwrap)
            .any(|n| n.starts_with("ppt/media/") && n.ends_with(".png"))
    );
    let path2 = thread(&p, &second, &with_objects);
    let(s,v)=request(&app.router(),"POST",&path2,Some(json!({"expected_version":2,"connection_id":c,"model_version":1,"prompt":"선택한 도형을 왼쪽 50% 위치로 이동","fields":["objects"],"object_ids":["shape-1"]})),Some(&Uuid::new_v4().to_string())).await;
    assert_eq!(s, 202, "{v}");
    let moved = proposal(&app, &path2, "ready").await;
    assert_eq!(
        moved["proposal"]["objects"][0],
        with_objects[0]["spec"]["objects"][0]
    );
    assert_eq!(moved["proposal"]["objects"][1]["frame"]["x"], 50.0);
    assert_eq!(
        moved["proposal"]["objects"][2],
        with_objects[0]["spec"]["objects"][2]
    );
    command(&app, &p, &moved, "apply").await;
    let third = wait_run(&app, &p, "succeeded").await;
    assert_eq!(third["presentation_version"], 3);
    let after = slides(&app, &p, &third).await;
    assert_eq!(after[1]["id"], with_objects[1]["id"]);
    assert_eq!(slides(&app, &p, &first).await, before);
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    assert_eq!(slides(&app, &p, &third).await, after);
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM presentation_media", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM presentation_slide_media", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        3
    );
    app.shutdown().await.unwrap();
}
