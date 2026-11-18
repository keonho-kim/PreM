# 데이터와 HTTP 계약

이 문서는 현재 구현된 저장·동시성·HTTP 계약을 설명한다. 전체 목표 스키마와 API 목록은 [데이터 설계](../blueprint/05-data-storage.md), [API 설계](../blueprint/08-rest-api.md)를 참조하며 구현 여부는 실제 handler와 테스트로 확인한다.

## 공통 규칙

- 업무 API는 `/api/v1` 아래에 있고 Admin API는 시작 토큰이 필요하다. 일반 프로젝트에는 계정·소유자 필터가 없다.
- 생성·작업 명령은 `Idempotency-Key`, 수정은 `expected_version` 또는 해당 endpoint의 버전 조건을 사용한다. 같은 키로 다른 내용을 보내거나 오래된 버전으로 쓰면 충돌이다.
- 외부 응답과 사용자 입력은 경계에서 검증한다. 클라이언트는 Zod로 성공 응답을 검사하며 오류·취소·재시도는 [공통 HTTP 어댑터](../frontend/src/shared/api/http.ts)가 구분한다.
- 비밀 키와 토큰은 일반 조회 응답에 포함하지 않는다. 원본 HTML은 다운로드만 허용하고 브라우저에서 실행하지 않는다.

`GET /api/v1/models/setup`은 활성 작성용 LLM의 존재 여부(`llm`)와 공용 판정 연결의 사용 가능 여부(`decision`)만 반환한다. 모델 서버 호출은 Admin에서 명시적으로 연결 진단을 실행할 때 발생한다.

모델 설정 초안은 먼저 `POST /api/v1/admin/llm/providers/{id}/diagnose`로 확인한다. 본문은 저장과 같으며 `thinking`과 `thinking_effort`는 각각 nullable boolean, nullable enum(low, medium, high, xhigh)이다. `decision: true`는 샘플 판정 경로를 선택한다. 성공 응답의 `ticket`을 `X-Connection-Diagnostic` 헤더에 넣어 같은 본문으로 PUT한다. 진단 실패·만료(15분)·입력 변경에는 새 진단이 필요하다. 서버는 주소·키를 포함한 초안의 해시와 버전을 확인하고 진단에서 결정한 유효 effort만 저장한다. 설정 리비전을 커밋하면 그 연결의 기존 진단표를 폐기한다.

## 주요 리소스

| 리소스         | HTTP 경로                      | 저장 책임                                   |
| -------------- | ------------------------------ | ------------------------------------------- |
| 프로젝트       | `/projects`                    | `modules/projects`                          |
| 프로젝트 원본  | `/projects/{id}/files`         | source item/version·Blob·문서 작업          |
| 작성 방향      | `/projects/{id}/guide`         | 불변 guide revision                         |
| 목차·원문 연결 | `/projects/{id}/outline`       | outline revision·canonical block assignment |
| Space 자료     | `/space/{kind}`                | 공용 reference/template 버전                |
| 자료 검색      | `/search`                      | 현재 공용 자료의 색인 조회                  |
| 발표자료       | `/projects/{id}/presentations` | run·slide·검토·리비전·PPTX                  |
| 모델 연결      | `/admin/llm/providers`         | 암호화된 불변 연결 설정                     |

실제 하위 명령과 DTO는 [HTTP 어댑터](../backend/src/adapters/http/)와 [통합 테스트](../backend/tests/)가 소유한다. 설계 문서에만 있는 경로를 동작하는 API로 간주하지 않는다.

프로젝트 응답의 `saved_stage`는 저장된 작업 중 가장 뒤의 단계를 나타낸다. 작업 순서에 따라 `created`, `sources`, `review`, `guide`, `outline`, `evidence`, `design`, `presentation`을 사용한다. 다음 단계 실행 가능 여부는 Studio가 현재 원본과 설정 버전으로 별도 확인한다.

프로젝트 원본과 Space 자료의 `GET …/processing/history?file_version=N`은 해당 파일 버전의 최신 처리 작업 한 건을 배열로 반환한다. 해당 작업이 없으면 빈 배열이다. 버전을 생략하면 최근 작업을 최대 50건 반환한다.

## Markdown 원본추출 계약

`.md`/`.markdown`은 UTF-8, 최대 2 MiB다. Rust Comrak 어댑터가 구조화 블록과 원문 위치를 저장한다. HTML·링크를 실행하거나 외부 이미지를 가져오지 않는다. Space 자료와 프로젝트 원본의 scope를 구분하며 원본 bytes는 다운로드할 수 있다.

## 공통 PPT 패키지와 저장 수명

원본 Blob과 추출 프로필을 기준으로 PPT 추출을 공유하며 페이지·블록·자료 재사용 항목은 canonical IDs를 참조한다. 이미지·패키지·미리보기는 별도 Blob이다. 삭제된 자료의 과거 생성물·백업 참조를 보존하며 즉시 파일을 없애지 않는다. native 재사용은 버전이 고정된 출처·검토·삽입 명령을 통해 수행한다.

## V18 검색 작업 공간

현재 원본·작성 방향과 후보 자료의 기간·단위·조건을 비교하고, 필요하면 주변 문맥과 추가 검색을 진행한다. 설정·입력을 고정하며 완료된 동일 판정과 checkpoint는 재사용한다. 외부 문서의 지시는 실행 권한이 아니다.

## V21 객체·이미지·일괄 수정 계약

SlideSpec v2는 선택적 objects와 layout을 추가한다. v1 원본 Blob은 그대로 읽으며 명시적 객체 수정 때만 v2 파생 Spec을 만든다. 객체는 안정적인 ID·이름·백분율 frame(x/y/width/height/rotation)과 image/chart/shape/text content다. 최대 20개 객체, 좌표 틀은 0~100%, 회전은 ±180도, 텍스트는 1,000자/8~72pt, 전체 Spec은 64 KiB 이하로 검증한다. chart는 column/bar/line/pie, 최대 20개 고유 항목·4개 고유 이름의 계열, 동일 배열 길이와 유한 수치(절댓값 10¹² 이하)를 요구한다. pie는 양의 합을 가진 단일 비음수 계열이다. 수치의 업무상 정확성은 사용자 검토 대상이다.

- `GET/POST /api/v1/projects/{p}/presentation-media`: 등록 목록/바이너리 이미지 업로드. POST는 name 질의와 Idempotency-Key, 최대 5 MiB를 받는다. 실제 디코딩은 PNG/JPEG/WebP 단일 이미지·1,600만 화소까지이며 PNG 결과는 8 MiB 이하다. 프로젝트당 100개 등록, 동시 정규화 2개를 제한한다. 같은 키의 다른 이름/원본은 409다.
- `GET /api/v1/projects/{p}/presentation-media/{id}`: 해당 프로젝트에 등록된 수동 PNG만 반환한다. 원본 바이트와 정규화 바이트는 각각 CAS에 저장한다. 등록에는 원본/PNG Blob FK와 크기만 기록하고 모델은 URL이나 경로를 지정할 수 없다.
- 기존 edit POST에 slide_ids(최대 24개, 기준 장표 포함), object_ids(단일 장표에서 최대 20개)를 추가한다. fields는 title/bullets/notes/objects/layout이다. object_ids가 있으면 objects만 수정하고 목록에 없는 객체·새 ID는 거부한다. 빈 object_ids는 대상 장표의 전체 객체 목록을 수정할 수 있다.
- `presentation_edit_targets`는 고정 source slide version, 위치, 객체 선택, 완료한 제안 Blob/요약/모델 요청을 소유한다. V20 요청은 단일 target으로 backfill한다. `presentation_edit_media`는 접수 시 사용 가능한 이미지 목록을 고정한다. `presentation_edit_target_media`와 `presentation_slide_media`는 제안/확정 장표의 이미지 참조를 추적한다.
- 작업은 대상 장표별 한 번씩 순차 추론하며 완성한 수정안을 lease 검사 후 checkpoint한다. 실패·취소 후 재시도는 미완료 대상만 처리한다. 완료 count는 응답 targets에 있고 slides는 각 장표의 before/proposal이다. 기존 scalar before/proposal도 기준 장표용으로 유지한다.
- 적용은 모든 target이 완료됐고 base deck이 최신일 때만 허용한다. 대상 장표만 새 version으로 만들고 미대상은 재사용하며 누락·변경한 장표만 렌더링·검사하고 통과한 장표를 네이티브 PPTX로 조립한 뒤 한 번 head를 전진시킨다. 명시적인 새 수정은 지원 가능한 과거 Spec을 현재 렌더러로 처리할 수 있지만 이미 실행 중인 작업의 runtime pin은 그대로 검사한다.

## V22 중앙 비교와 세션 되돌리기

새 수정안은 모델 결과를 장표별로 저장한 뒤 실제 PPTX·PNG를 렌더링하고 검증해야 ready가 된다. `presentation_edit_renders`는 검증된 PPTX Blob, `presentation_edit_previews`는 기준 slide ID별 PNG를 참조한다. 승인 후 생성 작업은 이 결과를 재사용한다. 기존 미리보기 없는 수정안은 이전 렌더링 경로로 적용한다.

`presentation_editor_sessions`는 프로젝트·발표자료·현재 기준 리비전·만료 시각만 보관하는 캐시 소유자다. 인증·계정·사용자 권한 기능이 아니다. `presentation_undo_stack`은 세션당 최대 3개의 이전 확정 리비전 참조를, `presentation_run_sessions`는 승인된 작업과 캐시 세션의 임시 관계를 보관한다. 세션 삭제는 두 캐시 테이블로 cascade하며 확정 산출물은 지우지 않는다. 종료된 세션에 속한 작업이 나중에 완료돼도 캐시를 다시 만들지 않는다.

- `POST /api/v1/projects/{p}/presentations/{run}/editor-sessions`: 메모리에서 생성한 session_id로 편집 방문을 연다. 새 방문은 빈 되돌리기 목록에서 시작한다.
- `PATCH /api/v1/projects/{p}/editor-sessions/{id}`: 활성 방문의 만료를 갱신한다. 클라이언트는 60초마다 갱신하며 30분 비활성 세션은 만료된다. 서버는 60초 간격과 관련 명령에서 만료 캐시를 삭제한다.
- `POST /api/v1/projects/{p}/editor-sessions/{id}/close`: 화면 이탈·프로젝트/발표자료 변경·pagehide의 닫기 신호를 처리한다. 반복 닫기는 안전하며 시작·종료 시에도 모든 캐시를 정리한다.
- edit apply 본문의 선택적 editor_session_id는 결과를 해당 세션의 되돌리기 목록에 연결한다. 기존 클라이언트의 생략된 값은 캐시를 만들지 않는다.
- `GET /api/v1/projects/{p}/presentations/{run}/history?session_id=...`: 직전 확정 run, 논리적 장표별 이전 slide ID, 해당 세션의 undo_remaining을 반환한다. 다른 방문자의 변경으로 기준이 달라졌다면 되돌리기는 0이다.
- `POST /api/v1/projects/{p}/presentations/{run}/undo`: expected_version·editor_session_id·Idempotency-Key로 최신 상태를 검사한 뒤 이전 상태를 새 확정 리비전으로 복원한다. PPTX·Spec·미리보기 바이트를 다시 만들지 않고 모델도 호출하지 않는다. 한도 소진·만료는 422, 오래된 상태는 409다.
- `GET /api/v1/projects/{p}/slide-edits/{edit}/slides/{source_slide}/preview`: 해당 프로젝트 수정안의 실제 PNG를 제공한다.

비교는 읽기 전용이다. 편집 세션이 끝나도 확정 버전 간 비교는 기존 리비전으로 가능하지만 되돌리기 캐시는 복원하지 않는다. `presentation_restorations`는 확정 복원 결과의 출처와 멱등 명령을 기록하며 캐시 테이블과 구분한다.

## 편집 모델 자동 선택과 수정 대상

편집 UI는 connection_id와 model_version을 보내지 않는다. 기존 API 클라이언트는 두 값을 함께 보낼 수 있으나 한쪽만 지정하면 거부한다. 생략하면 서버가 기준 run의 설정에서 연결을 찾고 현재 활성 LLM 설정을 접수 시 고정한다. 비활성·Decision 연결은 다른 모델로 대체하지 않고 설정 확인을 안내하는 422를 반환한다. 멱등 재요청은 처음 접수한 요청과 설정을 유지한다.

객체를 선택하면 objects와 해당 object_ids만 보낸다. 선택이 없으면 현재 장표 또는 명시적인 slide_ids 묶음의 title·bullets·notes·objects·layout 전체를 수정 가능한 범위로 보낸다. 모델은 요청하지 않은 필드에 null을 반환해 원래 값을 보존한다. null은 객체 삭제나 배치 초기화를 뜻하지 않는다. 브라우저 draft에는 요청문만 보관한다.

## V23 workflow execution checkpoints

workflow_executions stores definition key/version/signature; workflow_nodes stores node version, order, state, attempt, lease and timestamps. presentation_workflows links each canonical presentation job to one execution. workflow_events stores committed transitions with increasing IDs. workflow_artifacts references the render output and ordered preview Blobs through foreign keys. Job status, input revisions, model settings, runtime version and command receipts remain in presentation_runs.

Migration backfills completed runs as completed nodes and recognizes existing slide checkpoints without regenerating their bytes. New admission commits the job and graph together. Unsupported definitions, node versions or signatures fail with workflow_incompatible before invoking a handler. Existing endpoint paths and optimistic versions remain intact; run responses add steps(key/state/attempt).

The existing 30-second job lease and 2-second heartbeat fence commits. Interrupted execution automatically requeues for at most three attempts; explicit retry rechecks the existing base/input constraints. Restart resets running nodes to pending and preserves completed nodes and render output. Taking over a job invalidates the old node lease. Render checkpoint and node completion share a transaction; publication and final-node completion share another. No LLM or process call holds a write transaction. Event replay/SSE endpoints are not yet exposed.

## V24 document preparation checkpoints

`document_workflows` links canonical `document_jobs` to generic executions named `document:{job_id}`. Document v1 is extract → classify → ready; template v1 is extract → ready. An insertion trigger registers the graph in the same transaction as each new job, including uploads discovered at startup. Migration backfills existing extraction, classification and completed-template checkpoints without rewriting original bytes, blocks or previews.

Job/detail/history responses add `steps: [{key, state, attempt}]`; existing processing routes, expected versions and idempotency receipts remain intact. Document jobs retain status, immutable source/profile pins, model configuration and completed block decisions. Generic nodes retain execution state only. Each write validates visibility, the current 60-second lease and supported graph version/signature; heartbeat runs every two seconds. Failed or cancelled late results cannot advance a job.

Extraction association, canonical blocks, their FTS index and extract-node completion commit together. Template results have their existing atomic commit and are reused if interruption occurs before the node checkpoint. Final readiness verifies required extraction/template results and completed decisions, then commits ready-node completion and job success together. Search can read indexed text before classification finishes; readiness is not a second indexing pass. Classification progress is measured from completed/total blocks, not an estimate of total preparation time.

Missing model configuration releases the lease and leaves classification pending. Cancellation/retry and restart preserve completed extraction and decision batches; automatic interruption retries stop at three attempts. In-flight model calls without a committed batch may repeat. No exactly-once external call or independent per-page OCR recovery is claimed. Unsupported definitions fail before tool/model execution. Presentation recovery is scoped to presentation associations and cannot reset document nodes.

## V25 outline generation and mapping checkpoints

`outline_workflows` links canonical `outline_runs` to `outline:{run_id}` generic executions. Generation uses outline v1 compose → publish; mapping uses mapping v1 map → publish. Admission registers the graph in the same transaction through an insertion trigger. Existing completed batch responses are recognized during migration; original block IDs, request IDs, revisions, confirmations, source reviews, guide and model pins are unchanged.

Run/state/command responses add `steps: [{key, state, attempt}]`. Existing endpoints, expected versions and idempotency receipts remain intact. The feature owns run status and batch responses; generic tables own definition identity and node transitions. Every node begins under the supported definition and current 30-second canonical lease; the engine supervises heartbeat every two seconds and owns cancellation/join. Outline execution has one slot independent of document/template and PPT pools. Model connection queues remain a separate shared owner.

Each successful batch retains its existing validated alias response and request ID. Saving the final batch completes the compose/map node in the same transaction. Publication rebuilds the draft from canonical batch output and source IDs, validates pinned inputs and current base version, then advances the revision/head, completes publish and marks the run succeeded in one transaction. Publication failure rolls back the revision; explicit retry reuses the completed model stage. No original text is duplicated into node checkpoints.

Cancellation, project lifecycle cancellation, lease expiry and startup recovery update associated running node states in the canonical status transaction. Automatic interrupted attempts stop at three; explicit retry still requires valid original inputs and no other active project run. Late output with a cancelled/replaced/expired lease cannot write a batch or head. Completed batches survive retry/restart. Uncommitted in-flight model calls may repeat; exactly-once external execution is not claimed. Unsupported graph/node versions fail before inference. Relation and chat-proposal workflows also use the common engine; SSE/unified monitoring are not exposed by this migration.

## V26 relation execution checkpoints

`relation_workflows` links canonical relation_runs to `relation:{id}`. The graph is retrieve → review → publish. Candidate retrieval and its successful checkpoint share admission's transaction; an empty search can complete there without calling a model. Review retains existing v1/v2 bounded exploration, up to four parallel model groups, pinned Decision/planner settings, assessment cache and source context. Budget termination preserves partial results and a visible stop reason. Review checkpoint and budget closure share a transaction; final status and publish completion share another. Final-publication retry does not repeat review. Cancellation/project deletion/lease expiry/startup recovery update associated running nodes through canonical-status triggers. Automatic interrupted execution is bounded to three attempts. Responses add steps(key/state/attempt); no workflow SSE endpoint is introduced.

## V27 pinned native reference insertion

Generate optionally accepts materials: [{job_id, material_id}], up to ten choices. Empty selections are omitted from command fingerprints for compatibility. `presentation_generation_imports` pins registered source IDs at admission. After normal drafts complete, objects enrich the first slide and whole source slides append to the deck; `presentation_reference_drafts` retains the original model Spec Blob and records once-only enrichment. This is pre-publication generation work, not a change to a confirmed revision.

POST `/api/v1/projects/{p}/presentations/{run}/materials` accepts expected_version, slide_id, optional editor session and items: [{job_id,material_id}]. The target must be the current completed deck. The command retains its idempotency key/fingerprint, registers immutable imports and queues a render-only new revision. Objects modify the selected slide; source slides append immediately after it. At most 24 slides and 20 objects per slide apply. Project reference registrations are bounded to 500. With an editor session, the existing disposable three-step undo policy applies; no account layer is added.

`presentation_material_imports` references the canonical job/material; `presentation_slide_imports` records exact usage. `presentation_edit_imports` freezes allowed references and `presentation_edit_target_imports` records proposal usage. Originals stay in content-addressed storage, source text stays in content_blocks, and native package parts/workbooks remain editable in the output. SlideSpec v3 adds the typed reference object with a registered reference_id; v1/v2 remain readable. slide_key gives imported slides independent durable identity and preserves chat/comparison isolation when they share an outline section.

GET `/api/v1/projects/{p}/presentations/{run}/slides/{slide}/materials` returns pinned source metadata, exact job/page/version and availability for the Reference inspector. Logical deletion blocks new selection and source preview while existing confirmed output and pinned Blob references remain preserved. Runtime stages each distinct native source once, caps aggregate native bytes at 150 MiB and fits source geometry into destination bounds. PDF pages remain raster references; external source URLs are never fetched.

## V28 conversational execution checkpoints

`slide_edit_workflows` links canonical presentation_edits to `edit:{id}`. The graph is propose → render. Per-target validated proposals and final propose-node success commit together; native PPTX/preview registration, render-node success and ready status commit together. A render-only retry reuses proposals and their model requests. Late/cancelled leases cannot commit and automatic interruption retries stop at three attempts. Generic definition/node identity is checked before handlers.

Ready means a reviewable proposal, not an accepted deck. Apply remains explicit, checks the current head/session and reuses validated preview output through normal presentation publication. A bounded server-side source search can supply eight matching current shared material choices. Each target prompt includes its existing references plus at most twelve additional registered choices. The model may only propose allowlisted IDs/fields; normal source text cannot expand tool authority. Full provider-native multi-tool loops, generic Human Gate nodes, parallel DAG nodes and event-stream monitoring remain outside the implemented scope.

## V29 per-slide quality and render cache

`presentation_render_cache` has the composite key (project_id, cache_key), output/preview Blob FKs, report_json and last_used_at. It stores validated one-slide native PPTX and PNG outputs. A key hashes runtime profile, full Spec, destination position, template version and actually used image/reference identities and content hashes. Repair permission is not part of the key: a previously validated identical slide is reusable without changing it. Cached bytes are size/hash verified before use. Missing or damaged derived cache bytes are treated as a miss; source/confirmed output integrity is never reset.

`presentation_quality_checks` records workflow_id, project_id, style_key, slide_version_id, one-based position, passed, report_json and reused, uniquely per workflow/slide. Workflow and slide identities use canonical FKs; generation uses its run ID and conversation uses edit:{id}. A successful outcome, output metadata and cache entry commit in one transaction after checking project visibility, current edit base, membership, canonical job lease and the running render-node lease. Failed outcomes retain no successful render cache entry. Retries replace the check snapshot; confirmed revisions remain immutable.

Run and Edit responses add quality: [{position, reused, report}]. Report schema_version=1 contains passed, repair_attempts (0–2), issues: [{code, severity}] and optional typography: {title, body} in SVG-pixel units. Reports contain fixed codes, not source text/tool stderr. Ordinary UI maps them to office language and never shows cache/provider identifiers. Old completed work returns an empty list and is not automatically rerendered by migration.

The first generation (base_version=0, not a restoration) permits two deterministic font reductions, down to 22px title and 14px body. Text is never truncated. Later generation/editing uses its requested content without additional automatic fitting; already checked identical text/layout may retain its prior typography recipe. Object text and imported artwork are not silently reformatted. Layout estimates, missing source links, native text/chart values, raster aspect ratio and managed bounds are checked. Potential artwork overlap is a warning; blocking errors produce slide_quality_failed and preserve successful drafts/renders.

The derived cache is capped at 512 entries and 512 MiB per project, evicted by last use. This bounds live cache references, not immediate physical disk reclamation: backup references and the existing orphan grace period continue to protect Blob bytes. Durable style and quality records remain outside that cache. Every passed slide contributes one saved preview and native part; final assembly copies native part graphs and validates text/chart/workbook preservation. No LLM calls or rasterization of unchanged slides occur during assembly. Approved proposals map their saved quality/style records onto the newly published slide IDs without rendering again. Publication retains existing input/CAS, cancellation, idempotency and explicit approval rules.

## V30 manual canvas authoring

`presentation_manual_designs` pins a project and optional immutable template job. presentation_runs permits nullable design_id/config_id and adds manual_design_id; exactly one design owner is required. No fake provider, outline or evidence rows are created for blank decks. presentation_edits permits a null outline node while retaining a real source slide, revision and model pin. The backed-up migration rebuilds these parent tables, copies IDs/records, restores existing triggers/indexes and checks every FK.

POST `/api/v1/projects/{p}/presentations/blank` accepts title, template_job_id|null and layout_key. GET `/api/v1/projects/{p}/presentation-layouts` accepts either template_job_id or run_id, returning bounded native layout choices, names, slot frames/capacities and example pages. Fresh choices require an active prepared template; existing deck operations retain their pinned template bytes.

POST `/api/v1/projects/{p}/presentations/{run}/canvas` accepts expected_version, slide_id, session|null and a typed operation. Operations are geometry(placements), insert(object), text(object_id/text), add_slide(layout_key), duplicate_slide, delete_slide and move_slide(position). Frames remain percentage coordinates within the slide. Direct reference IDs are not accepted by insert: reuse the existing version-pinned material insertion API. Image IDs must belong to this project. All writes require Idempotency-Key, canonical project/current head and optional live editor-session checks; every fork queues ordinary rendering/publication and reuses untouched slide versions.

`presentation_canvas_commands` records the base revision and operation for render-only manual forks. Receipts retain a bounded hash of command content, not copied source text. Input hashes and source/Spec IDs remain canonical. Cancel/retry, conditional publication, immutable outputs and disposable three-entry undo continue through the existing engine.

SlideSpec v4 design={layout_key, authored} identifies the selected native layout. Authored manual slides may have empty title/body/evidence. Model-authored template slides must have real block IDs and authored=false. The model receives up to twelve eligible layouts within a 10 KiB context budget, chooses a permitted layout and returns slot_id/content choices. Rust hydrates actual object frames from the pinned layout and checks role, text capacity and all selected reference IDs. Source-defined geometry is not accepted from model output. Native rendering preserves template masters/styles and puts extra text into actual placeholders.

The provider response schema nests additional objects inside its chosen design variant. Each variant exposes only that layout's additional slots and compatible content kinds; primary title/body slots are reserved for the root title/bullets fields. A layout without additional slots requires an empty array. The adapter converts this response into the existing flat SlideSpec v4 objects array before persistence, so saved revisions keep their existing schema. Server validation remains authoritative when a provider ignores the supplied schema.

## V31 passive canvas artwork layers

presentation_quality_checks adds cache_key. `presentation_render_layers` stores the project/render key, namespaced object key, PNG Blob FK and derived frame. Rows cascade only with derived cache eviction. The background key cannot collide with an authored object's ID. Quality checkpoints and approved proposal/undo mapping retain the exact key; confirmed PPTX and full previews stay independent.

GET `/api/v1/projects/{p}/presentations/{run}/slides/{slide}/layers` returns available layer IDs/frames. GET the same path plus `/{layer}` streams a passive PNG after project/run/slide and successful-check membership validation. No arbitrary paths, SVG, model URLs or provider secrets are returned. Missing legacy/evicted layers return an empty catalog and retain the full preview fallback.

Native shape metadata binds top-level actual shapes to their specs. lxml isolates generated SVG copies and bundled Sharp rasterizes at most 21 PNGs, 4 MiB each and 64 MiB total, without source execution in the browser. Existing per-project 512-entry/512-MiB live cache budgeting includes layers. Logical eviction does not bypass reference/backup protection or the Blob grace period.

## V32 per-model generation budget

`llm_provider_config_versions.max_output_tokens` is nullable, with integer bounds 256–65,536. Existing configuration rows keep null and retain caller-owned task defaults. Admin provider GET/PUT exposes the optional value; a save creates a new immutable configuration and retains optimistic version checks. The model server's loaded context is a separate concern and is never changed by ordinary application requests.

The same migration preserves all existing timeout values and expands their validated range to 5–900 seconds. The default remains 180 seconds; opt-in local-model acceptance uses 600 seconds. HTTP transport and the shared execution deadline use the pinned value, while cancellation and queue admission remain separately bounded.

Structured authoring resolves the override from its pinned configuration before provider serialization. This covers outline, presentation and chat authoring; changing the connection cannot change an already pinned job. Diagnostics and typed Decision execution keep their own budgets. Invalid values or a budget on a Decision-only connection are rejected. Saving a budget does not regenerate existing results.

## Selected outline generation

GET `/api/v1/projects/{p}/presentation-preparation/sections?design_id={id}` returns the current reviewed design's `outline_revision_id` and ordered `sections` (`id`, `parent_id`, `title`). An outdated design returns a conflict. This is a read-only canonical projection and never triggers analysis or generation.

POST `/api/v1/projects/{p}/presentations` accepts optional `node_ids`. Omission/null preserves legacy all-section generation and its serialized command fingerprint. An explicit empty array or duplicate/unknown IDs is rejected. Branches expand to unique leaf nodes in outline order, including when a branch and its child are both requested. The server normalizes request IDs for idempotency and validates them against the project's pinned outline revision before admitting work.

No migration or duplicate outline storage is required: the reviewed design pins its outline revision, immutable command receipts identify the requested scope, and `presentation_slide_versions.node_id` records the resolved scope. Only those nodes receive writing calls; explicitly chosen whole source slides/pages may still be appended. Existing optimistic head commits, cancellation, retries and checkpoints apply. A newly scoped revision contains that chosen scope, not an automatic merge with unchecked slides from the previous revision; earlier files remain available.

## 생성 모델 자동 선택

PPT 생성 UI는 `connection_id`와 `model_version`을 보내지 않는다. `POST /api/v1/projects/{p}/presentations`는 두 필드의 동시 생략/null을 허용하며 명시적으로 제공하는 기존 클라이언트는 두 값을 함께 보내야 한다. 기존 명시적 요청의 직렬화 fingerprint는 유지한다. 신규 생성은 활성 LLM 연결을 최초 등록 시각·연결 ID 순으로 선택한다. 설정 수정으로 기본 순서가 달라지지 않으며 Decision 연결은 제외한다. 기존 발표자료의 새 버전은 현재 head의 연결을 우선하며, 비활성/사용 불가 상태면 다른 연결로 대체하지 않고 422를 반환한다. 수동 빈 장표처럼 연결이 없는 자료는 신규 기본 선택 규칙을 사용한다.

선택은 생성 접수의 짧은 SQLite 트랜잭션에서 이루어지고 기존 `presentation_runs.config_id`에 불변 설정 버전을 고정한다. 설정 변경은 접수한 작업이나 멱등 재요청을 재지정하지 않는다. 연결이 없거나 유효하지 않으면 관리자 확인이 필요하다는 일반 문구를 반환하며 작업이나 빈 발표자료를 남기지 않는다. 이 계약은 기존 Admin 연결 설정을 사용하며 별도의 작업별 라우팅 테이블·UI 구현을 뜻하지 않는다.

## 생성 화면의 목차 수정

`PUT /api/v1/projects/{p}/outline-for-presentation`은 `outline`(expected_version, source_snapshot, guide_version, draft)와 `template_job_id`, `expected_design_version`을 받는다. application orchestration이 outlines의 저장·확정, presentations의 근거 확인·디자인 저장 facade를 순차 호출한다. 각 쓰기는 기존 짧은 CAS 트랜잭션을 사용한다. 전체 작업을 하나의 DB 트랜잭션이라고 가정하지 않는다. 중간 실패 시 저장된 목차는 유지되며 동일한 바로 다음 리비전·입력 스냅샷·초안인 경우 재요청으로 확인을 이어갈 수 있다. 다른 수정이 intervened하면 409를 반환한다. 성공하면 Preparation을 반환하고 이전 PPT나 모델 작업은 실행하지 않는다. 새 중목차의 초기 연결은 상위 가지의 canonical 블록 ID를 재사용하며 근거 없는 새 대목차는 별도 원문 연결이 필요하다.

## 공통 판정 연결 (V33)

`decision_settings`가 문서 처리와 자료 찾기의 공통 연결 ID와 CAS 버전을 소유한다. 기존 document/relation 설정 API는 같은 선택값을 읽고 SQLite 공통 commit 함수로 갱신한다. V33은 기존 문서 설정을 우선하고 미지정이면 자료 찾기 설정을 채택한다. 원래 두 설정 행은 보존한다. 이미 시작한 작업의 config revision은 바꾸지 않는다. 미설정 문서는 추출 전 `waiting_configuration`으로 대기하고, 새 자료 찾기 요청은 `decision_model_required` 422로 거부한다. 템플릿의 모델 불필요한 미리보기 처리는 유지한다.

## Provider 설정·진단 API

`/api/v1/admin/llm/providers` 아래의 연결 조회·저장·모델 목록·연결 테스트·용량 설정·요청 이력은 Admin 토큰이 필요하다. 설정 저장은 버전을 확인하고 새 immutable config를 만든다. 진행 요청은 접수 시의 config와 출력 한도를 사용한다. 주소·키 교체 시 기존 비밀의 전달 대상을 확인하며 응답은 비밀 원문을 노출하지 않는다. [handler](../backend/src/adapters/http/providers.rs)가 실제 하위 경로를 소유한다.

## Decision 설정과 평가 API

판정 입력은 state와 이름 있는 choice 질문/선택지다. LLM bridge는 스키마에 맞는 답만 허용하며 확률을 만들어내지 않는다. native 판정은 Provider가 반환한 통계를 검증한다. 공통 선택은 V33 설정이고 문서 준비와 관계 검색에 공유한다. [adapter](../backend/src/adapters/http/decisions.rs)와 [계약 테스트](../backend/tests/decisions.rs)를 따른다.

## Space 통합 검색 API

`GET /api/v1/search`는 현재 공용 reference/template의 메타데이터·본문을 조회한다. 원본 HTML을 실행하지 않고 literal query 강조와 정확한 job/page/version으로 이동한다. 프로젝트 원본의 관계 검색은 별도 scope다. [검색 handler](../backend/src/adapters/http/search.rs).

## Studio 원본·가이드 API

프로젝트 files는 다른 프로젝트나 Space로 자동 복제되지 않는다. source-review는 현재 원본 snapshot을 명시적으로 확인한다. guide는 optional Do/Don't의 불변 버전이며 저장만으로 생성 작업을 시작하지 않는다. 이후 입력이 바뀌면 이전 결과를 보존하고 재검토를 요구한다.

## 목차·콘텐츠 리비전과 작업

목차는 stable node ID와 불변 revision, 원문 연결은 canonical block ID를 사용한다. 생성·매핑은 source snapshot·guide·model config를 고정하고 명시적 명령으로 실행한다. 수동 편집·확정은 버전을 검사하며 stale 결과가 공유 변경을 덮어쓰지 못한다.

## 관계 검색 저장·API 계약

관계 검색은 현재 원본과 후보 버전·판정 설정을 고정한다. 공용 라이브러리 검색과 달리 프로젝트 간 소속·차이·재사용 가능성을 비교하고 선택 근거를 버전으로 보존한다. 같은 입력 판정은 재사용하며 원문/설정이 달라지면 새로운 입력으로 처리한다. [handler](../backend/src/adapters/http/relations.rs).

## V19 발표자료 준비·생성

검토한 원본·가이드·목차·근거·디자인을 고정하고 장표별 spec과 PPTX를 생성한다. 원문·선택 범위를 검증하며 생성·재생성은 명시적 요청이다. 완료한 장표·렌더는 재시도에서 재사용하고 최종 결과는 revision 조건으로 게시한다.

## V20 슬라이드 대화 수정

대화 요청은 원본 deck revision과 선택 slide/object/field 범위를 고정한다. 수정안은 즉시 적용하지 않고 비교·검토 후 새 revision으로 게시한다. 여러 장표는 개별 제안을 checkpoint하고 전체 준비 후 함께 적용한다. 후속 객체·세션·실행 계약은 V21 이후 절을 따른다.

## V34 원본 페이지 대목차

문서 상세 API의 `pages[].alignment`는 완료한 처리 작업에 귀속된다. `section`·`preceding_section`은 현재 장 및 페이지 중간 전환 시 확인한 이전 장이다. `toc_block`·`toc_line`(0부터 시작)·`toc_printed_start`는 원본 목차 근거, `evidence_block`은 현재 페이지의 근거다. `source_page`는 원본 위치이고 `alignment.printed_page`는 선택적으로 보정한 추정값이다. `unknown`은 미확정, `range`는 앞뒤 장 시작점에 따른 범위 추정이다. `null`은 결과가 없는 과거 작업·처리 중인 페이지·물리 경계가 없는 형식 등을 뜻한다. V34는 기존 추출과 목차를 변경하지 않는다.

## V35 모델별 토큰 설정

LLM 연결의 `max_output_tokens`는 작성·연결 테스트·LLM 기반 판정 요청의 생성 한도다. LM Studio의 LLM·Decision 연결은 `context_length`와 `physical_batch_size`를 선택적으로 같은 설정 리비전에 저장한다. 미지정한 값은 서버 기본값을 따른다. Admin의 모델 준비 명령(`POST /api/v1/admin/llm/providers/{id}/prepare`, `expected_version`)은 현재 인벤토리에서 같은 모델·설정을 먼저 찾고, 필요할 때만 LM Studio의 `/api/v1/models/load`를 호출한다. 물리 배치를 지정하면 평가 배치도 같은 값으로 요청한다. 모델 키를 선택하면 재로딩 후에도 같은 모델을 찾을 수 있다.

토큰 로딩 설정이 있는 추론은 각 요청에 고정된 조건으로 실제 인스턴스를 선택한다. 서버 재시작 등으로 일치하는 인스턴스가 사라지면 Admin에서 다시 준비한다. 준비한 인스턴스의 메모리 사용·언로드는 LM Studio에서 관리한다. 컨텍스트, 물리 배치, 최대 출력은 별도 값이며 로딩 설정은 LM Studio 프로토콜에서 제공한다.

## V36 원문 목차

문서 상세의 `source_outline`은 작업별 대목차와 그 아래 `children`을 원본 순서로 반환한다. 각 행은 제목·선택적 인쇄 쪽수·원본 블록 ID·블록 안의 줄 번호를 가진다. `document_source_entries`는 작업/순번과 같은 작업 내 부모 순번을 참조하며 페이지 소속과 같은 트랜잭션에서 공개된다. 이전 완료 작업에는 빈 목록을 반환한다. 새 LM Studio 연결의 Admin 물리 배치 기본값은 2048이며 저장된 연결의 값과 서버에서 관리하도록 명시한 빈 값은 유지한다.
