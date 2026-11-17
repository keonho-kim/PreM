# 아키텍처와 모듈 책임

PreM는 하나의 Rust/Axum 애플리케이션이 React UI와 API를 제공하는 단일 배포 단위다. SQLite·Blob·암호화 키는 지정한 저장 루트가 소유한다. 제품 요구사항과 목표 경계는 [blueprint](../blueprint/02-system-architecture.md), 현재 데이터/API는 [데이터 계약](04-data-api.md)을 따른다.

## 실행과 소유권

- `backend/src/app/`: CLI 설정, 서비스 조합, worker 시작·취소·종료.
- `backend/src/modules/`: 프로젝트·자료·문서·가이드·목차·프레젠테이션·모델·판정의 기능 규칙과 소비자 소유 port.
- `backend/src/adapters/`: HTTP DTO, SQLite SQL, 파일·모델·외부 프로세스 구현.
- `backend/src/workflows/`: 영속 단계·lease·checkpoint와 기능별 실행 정의.
- `backend/src/prompts/`: 작업별 정적 지시문. 입력 데이터·스키마·응답 검증은 해당 기능에 남는다.

일반 사용자는 계정 없이 공유 프로젝트를 사용한다. Admin UI/API만 프로세스 시작 시 생성되는 토큰으로 보호한다. 외부 네트워크·HTTPS는 배포 인프라의 책임이다.

## 저장과 실행 경계

SQLite 쓰기는 소유한 writer를 통해 짧은 트랜잭션으로 수행한다. 파일 변환·모델 호출은 트랜잭션 밖에서 실행하고, 결과는 원본 버전·설정 버전·lease를 확인한 뒤 커밋한다. 원본과 생성물은 내용 해시 Blob, 편집 결과는 불변 리비전으로 보존한다. 공유 변경은 expected version 또는 멱등 키로 검증한다.

작업 재시도는 완료한 checkpoint를 재사용한다. 설정을 저장했다고 기존 결과를 재생성하지 않는다. 런타임 프로필이 달라진 진행 작업은 동일 실행 환경으로 가장하지 않는다.

## 프론트엔드 계층

`app → pages → features → shared` 방향을 따른다. feature 내부는 요청·draft·화면·작업 제어로 분리하며 peer 구현을 직접 가져오지 않는다. shadcn/Radix가 포커스·닫기·키보드 탐색을 소유한다. 디자인 기준은 [디자인과 접근성](05-design-accessibility.md)에만 정의한다.

## Common execution engine: presentation integration

`backend/src/workflows/engine/` owns bounded job admission, dependency traversal, completed-node reuse, heartbeat supervision, cancellation propagation and joining its monitor task. `workflows/definitions/` owns presentation v1 (write → render → publish), document v1 (extract → classify → ready) template v1 (extract → ready), outline v1 (compose → publish) and mapping v1 (map → publish). App injects independent document/template (two slots), outline/mapping (one slot) and PPT (one slot) engines into their workers. Existing model connection limits and queues remain with model_execution.

`modules/presentations/execution.rs` implements the engine's Driver boundary. PPT context construction, model calls, rendering and publication remain feature operations. `adapters/sqlite/workflows.rs` owns generic definition/node/event/artifact writes. The presentation bridge checks the canonical job lease in short transactions before committing a checkpoint. The existing presentation_runs row remains the single owner of job status, pinned inputs and command receipts.

Render output Blob references and render-node completion commit atomically. Publication, deck-head advancement and publish-node completion commit atomically. A publication-only failure resumes from saved output without calling the model or renderer again. Interrupted inference before a slide checkpoint can still repeat a read-only model call; exactly-once external execution is not claimed.

Document/template execution also uses the common Driver through `modules/documents/execution.rs`; extraction and batch classification remain feature handlers. `adapters/sqlite/documents/execution.rs` validates the canonical document job and lease for every node commit. OCR is conditional work within extraction, not an independently resumable page node. Template preparation never runs document classification. Outline generation and mapping use `modules/outlines/execution.rs` as their Driver, with the existing missing-batch handler in worker.rs. `adapters/sqlite/outlines/execution.rs` fences generic checkpoints against canonical outline_runs; final batch output and work-node completion commit together, as do revision/head advancement and publish-node completion. Publication-only retry never repeats model batches. Relations consumes a one-slot engine with admission-time retrieval, bounded review/exploration and atomic result publication. Per-candidate parallel model calls and search budgets remain feature-owned. Chat proposals consume propose → render through an EditDriver wrapper; generation and editing share the existing one-slot PPT schedule. The user approval command remains outside generic execution and queues the normal publication pipeline. Accepted chat edits use the common PPT publication pipeline. DAG nodes currently execute sequentially; dependency joins are validated. Parallel nodes, dynamic branching, general human gates, workflow SSE and a unified Admin monitor remain follow-on work. The presentation API exposes committed steps; UI labels use ordinary office language.

## Native reference insertion ownership

`modules/presentations/references.rs` owns explicit reference commands and derived SlideSpec creation. SQLite `references.rs` resolves canonical material IDs, import registrations, current-head/idempotency checks and manual insertion commits; `reference_generation.rs` pins selections at initial admission and enriches drafts once before first rendering. Documents retains extraction, original content and native locators. The presentation feature stores IDs/FKs instead of source text or duplicate file bytes. Independent slide_key identity separates added source slides from the originating outline section for history and chat threads.

The process adapter stages each distinct source Blob once and bounds total native source bytes to 150 MiB. `presentation-references.py` uses existing pinned python-pptx OPC parts and shapes to clone native slide/layout/master/theme and chart/workbook dependencies. No new merger framework or runtime package is installed. Shape IDs and relationships are remapped; private parts remain independent per placed source. External non-hyperlink relationships are rejected and no referenced URL is fetched. Source aspect ratios are fitted to the destination canvas; advanced effects/font fidelity require document-specific acceptance.

## Per-slide quality ownership

`modules/presentations/quality.rs` owns bounded rendering policy, exact render keys, checked typography reuse, per-slide checkpoints and final assembly orchestration. Its narrow QualityStore port is implemented by `adapters/sqlite/presentations/quality.rs`; no raw database handle enters the feature. This remains work inside the versioned render node, not a second mutable workflow status or generic parallel graph.

`presentation_inputs.rs` stages only registered assets, `presentations.rs` supervises a single-slide native render/Kordoc/preview, and `presentation_assembly.rs` assembles saved parts. Python helpers own deterministic typography estimates and native shape checks; the existing OPC reference adapter preserves source themes, charts and embedded workbooks. Provider inference remains in the existing write/propose handlers and is never replayed for a rendering-only retry.

Passed cache bytes are verified before reuse. The key includes runtime, Spec, position, template and actually used canonical media/reference versions within one project. A separate content/layout style key retains the already checked title/body font recipe when an object-only edit needs a new native render. Cache eviction removes derived lookup rows at 512 entries or 512 MiB per project; confirmed deck/slide revisions and durable quality/style reports remain. File collection keeps existing reference, backup and seven-day grace rules.

## 모델 작업과 프롬프트 책임

`backend/src/prompts/`는 문서 판정·목차·자료 관계·장표 작성·수정·진단의 정적 지시문과 선택지 상수를 작업별로 소유한다. DB 조회, 모델 실행, 출력 검증은 포함하지 않는다. 정적 지시문은 빌드에 포함되며 Admin에서 편집하는 설정이 아니다.

- `modules/documents/classification/`: 분류 실행과 판정 요청 구성을 분리한다.
- `modules/outlines/model/`: 목차 생성·원문 연결의 요청과 응답 검증을 분리한다.
- `modules/presentations/authoring/`: 장표 요청, 응답 검증, 실제 템플릿 슬롯 규칙을 소유한다.
- `modules/presentations/editing/`: 수정 명령, 실행, 요청, 응답, 미리보기, 타입을 소유한다. 선택한 여러 장표는 각각 호출·체크포인트하고 모두 준비된 뒤 함께 검토·적용한다.
- `modules/inference/context.rs`: 작업이 지정한 근거 배열에 직렬화된 JSON 바이트 예산을 배분한다. SQL 어댑터는 원문과 정본 ID를 읽고, 입력 소유자가 최종 스키마·템플릿을 포함한 요청 한도를 검사한다.

목차 요청은 system+입력 32 KiB, 장표 작성은 30,000바이트, 수정은 24 KiB 한도를 유지한다. 짧은 근거는 온전히 보존하고, 전체 입력이 초과하면 근거별 문자 상한을 공평하게 배분한다. 긴 근거는 앞·뒤 발췌와 `partial`, 원문 문자 수, Unicode 문자 기준 `[start,end)` 범위를 전달한다. 지시·스키마만으로 예산이 부족하거나 근거에 최소 128문자도 배분할 수 없으면 요청을 거부한다. 이는 모델별 토크나이저·컨텍스트 창 자동 산정이 아니다.

목차 생성은 기존의 문서별 균형·제목 우선 최대 48블록 선택을 유지하며 제공/전체 블록 수를 전달한다. 매핑은 기존 배치별로 실행한다. 큰 문서 전체의 의미 보존, 중간 발췌의 자동 재검색이나 다단계 요약을 구현한 것으로 취급하지 않는다. 장표 요청은 전체 목차 제목과 현재 절을 함께 전달하지만 다른 장표의 완성 문구를 읽는 전체 발표 검토 단계는 없다.

근거 ID는 정본 연결·검증에 사용하며 렌더러가 장표에 자동 출력하지 않는다. 작성 지시문도 제목·본문·발표 메모에 내부 ID나 진단 문구를 넣지 않도록 한다. 프롬프트는 목적·범위·근거·출력 규칙으로 작성하며, 목적이나 청중이 제공되지 않으면 추정하지 않는다. 문서 내용은 명령으로 취급하지 않고 출력은 서버의 스키마·선택 범위 검증을 거친다.

## 프론트엔드 작업 모듈과 상태 소유

라우팅은 `app/routing/router.tsx`의 TanStack Router 코드 기반 트리가 소유한다. `/home` base path와 기존 bookmark alias를 유지하며 동적 경로는 타입이 있는 params, query는 search로 전달한다. `shared/routing/search.ts`는 기존 URL의 문자열 직렬화 계약을 유지한다. 숫자처럼 보이는 ID와 `false`도 문자열이며, 값 검증은 각 feature의 기존 parser가 수행한다. Query의 서버 캐시를 Router loader에 중복 저장하지 않는다.

Studio는 `workspace/`에서 단계 조합, Query 조회, 원본 목록 화면을 분리한다. 목차는 `editor/`의 화면과 버전 고정 draft session으로 나눈다. 장표 직접 편집은 `canvas-controls/`의 명령 스트립·위치 폼·텍스트 폼으로 구성하고 Radix가 팝오버 초점/닫기를 계속 소유한다.

모델 연결의 `connection-form/`은 화면, 폼 값, 저장/충돌 처리 훅으로 나눈다. React Hook Form은 입력·dirty·reset·submit을 소유하고 Query mutation은 서버 저장을 소유한다. `reset(..., {keepDirtyValues:true})`로 다른 접속자의 변경에서 미편집 필드만 갱신한다. 연결 주소 변경 후 새 키 확인, 비밀 값 비노출, 설정 version 충돌과 명시적 저장 확인은 해당 기능 규칙이다. 폼 값은 전역 store나 영속 저장소로 옮기지 않는다.

공유 UI 상태는 Redux Toolkit, 서버 데이터는 TanStack Query, JSON 전송은 Axios, 응답 검증은 Zod, 파일 전송은 Uppy를 사용한다. Redux에는 작업 패널 표시 상태와 범위별 미전송 대화 초안만 보관하며 서버 캐시·파일 객체·토큰을 넣지 않는다. 단순 폼은 기존 React/native validation을 유지하며 React Hook Form 적용 완료 범위는 모델 연결 폼이다.

`pnpm check:structure`는 소스 350줄 한도와 dependency-cruiser의 순환 참조·계층 방향·peer feature 공개 진입점을 검사한다. 타입 import도 포함하며 feature stylesheet는 기존 공유 CSS 경계로 허용한다. 테스트 전용 모듈은 `src/test/`에 두고 실제 TanStack memory history를 사용한다. Git에 속하지 않는 runtime·data·build 결과는 줄 수 검사에서 제외하며, 모든 현재 authored source에 350줄 한도를 적용한다.

Redux Toolkit의 `configureStore`와 기본 불변성·직렬화 검사 미들웨어, `createSlice`/Immer를 사용한다. 대화 초안은 `createEntityAdapter`의 정규화된 ids/entities 및 생성 selector로 관리하며 최근 수정 순서로 128개를 유지한다. 작업 패널은 slice selectors를 사용한다. 서버 API는 TanStack Query가 소유하므로 RTK Query에 중복 등록하지 않으며, 현재 사용처가 없는 async thunk·listener를 추가하지 않는다.

## Markdown 처리 책임

`adapters/markdown`는 Comrak으로 원문을 블록과 위치로 변환한다. documents는 준비 상태·분류·검색 준비를, assets는 원본과 결과 Blob을 소유한다. HTML이나 링크를 실행하지 않으며 원문을 목차/장표 테이블에 복제하지 않는다.

## 추론·카탈로그·시작 복구의 책임

model_registry는 Provider 카탈로그·설정·선택을, model_execution은 요청 수명·대기열·취소·이력을, inference는 생성 정책과 구조화 응답 검증을 소유한다. decisions는 choice 계약을 native API 또는 명시적으로 선택한 LLM bridge에 연결한다. app은 시작 시 저장소·키를 검증하고 각 기능의 복구를 조합한다. HTTP나 모델 어댑터가 다른 기능의 내부 테이블을 직접 갱신하지 않는다.
