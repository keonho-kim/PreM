# REST API

PuPuTyX 통합 제품·기술 설계서 v2.0. 원문 **10장**을 수록한다. [문서 색인](README.md)

## 공통 계약

- 기본 경로는 `/api/v1`이다.
- 이벤트 스트리밍은 SSE를 사용한다.
- 리비전 수정 API는 버전 조건을 받아 충돌을 검사한다.
- 중복 생성 방지가 필요한 API는 `Idempotency-Key`를 지원한다.
- 장기 작업의 실행·진행·재시도는 [Workflow 계약](04-workflow-engine.md)을 따른다. 일반 HTTP 요청이 변환·생성 완료까지 블로킹하지 않도록 한다.
- 가이드·Provider 설정 저장만으로 기존 결과를 재생성하지 않는다.
- 일반 사용자 로그인·프로젝트별 권한은 없다. `/api/v1/admin` 전체는 서버 시작 시 발급한 토큰으로 보호하며 [회사 네트워크 보호](09-operations-delivery.md)도 적용한다.

프로젝트 목록·검색·일정/상태 필터·생성·이름 변경·보관/복원·논리 삭제는 구현되었으며 구체적인 DTO·제한·멱등성·충돌 계약은 [현재 데이터/API 명세](../dev-docs/04-data-api.md)에 정의한다. 공용 원본 관리의 현재 Space 경로는 이 문서 하단에 명시한다. 아래 나머지 기능은 목표 계약이다.

아래는 원문에 제시된 엔드포인트 목록이다. 요청·응답 DTO, 상태 코드, 페이지네이션, 오류 스키마와 버전 조건 전달 형식은 별도 상세 명세 대상이며 이 문서에서 임의로 확정하지 않는다.

## 10.1 프로젝트

```text
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/{id}
PATCH  /api/v1/projects/{id}
DELETE /api/v1/projects/{id}
```

프로젝트 목록은 모든 접속자가 공유한다. 생성 입력과 관리 동작은 [프로젝트 관리](03-product-features.md)를 따른다. 삭제는 [원본·Blob 보존 정책](05-data-storage.md)을 준수한다.

## 10.2 문서

```text
POST   /api/v1/projects/{id}/files
GET    /api/v1/projects/{id}/files
GET    /api/v1/files/{id}
GET    /api/v1/files/{id}/download
GET    /api/v1/files/{id}/pages
GET    /api/v1/files/{id}/pages/{page}
POST   /api/v1/files/{id}/reprocess
```

원본 업로드·다운로드, 페이지 조회와 명시적 재처리를 제공한다. 재처리 실패 시에도 기존 원본을 보존한다. 페이지 단위 재추출의 범위 지정 형식은 상세 요청 스키마에서 정의해야 한다.

## 10.3 프로젝트 가이드

```text
GET    /api/v1/projects/{id}/guide
PUT    /api/v1/projects/{id}/guide
GET    /api/v1/projects/{id}/guide/revisions
GET    /api/v1/projects/{id}/guide/revisions/{rev}
```

가이드 저장은 새 불변 리비전을 생성하는 DB 변경만 수행한다. 기존 목차·매핑·탐색 결과·PPT는 그대로 유지한다.

## 10.4 목차 및 매핑

```text
GET    /api/v1/projects/{id}/outlines
POST   /api/v1/projects/{id}/outlines
PUT    /api/v1/outlines/{id}
GET    /api/v1/outlines/{id}/assignments
PUT    /api/v1/outlines/{id}/assignments
POST   /api/v1/outlines/{id}/regenerate
```

수동 수정과 명시적 재생성을 구분한다. 콘텐츠는 `content_block_id`로 연결하며 같은 블록의 다중 목차 매핑을 허용한다.

## 10.5 레퍼런스·템플릿

```text
GET    /api/v1/references
POST   /api/v1/references/search
POST   /api/v1/projects/{id}/references/discover
GET    /api/v1/templates
POST   /api/v1/templates/search
POST   /api/v1/projects/{id}/templates/discover
```

검색과 프로젝트 단위 재탐색은 구분한다. 공용·프로젝트 로컬 범위와 선택한 버전을 보존하며, 사용자 업로드만으로 공용 등록하지 않는다.

## 10.6 PPT

```text
POST   /api/v1/projects/{id}/presentations
GET    /api/v1/projects/{id}/presentations
GET    /api/v1/presentations/{id}
GET    /api/v1/presentations/{id}/revisions
POST   /api/v1/presentations/{id}/generate
POST   /api/v1/presentations/{id}/regenerate
GET    /api/v1/presentations/{id}/download
GET    /api/v1/slides/{id}
POST   /api/v1/slides/{id}/edit
GET    /api/v1/slides/{id}/revisions
```

생성 요청은 가이드·목차·템플릿·레퍼런스 등 입력을 고정한다. 수정은 새 SlideSpec과 슬라이드 리비전으로 처리한다. 필요한 경우 다운로드 시 전체 PPTX를 새 프레젠테이션 리비전으로 조립한다.

## 10.7 Workflow

```text
GET    /api/v1/workflow-runs
GET    /api/v1/workflow-runs/{id}
POST   /api/v1/workflow-runs/{id}/retry
POST   /api/v1/workflow-runs/{id}/cancel
POST   /api/v1/workflow-runs/{id}/resume
GET    /api/v1/workflow-runs/{id}/events
```

이벤트 ID를 저장하여 브라우저가 재연결한 경우 놓친 이벤트를 이어받는다. 노드·Run의 상태, 오류, 재시도는 영속 이력을 기반으로 표시한다.

시스템 아키텍처에는 공통 SSE 경로 `/api/v1/events`도 제시되어 있다. 공통 스트림과 Run별 스트림의 구독 범위·중복 처리·재연결 계약은 상세 API 설계에서 함께 확정한다.

## 10.8 Admin

```text
GET    /api/v1/admin/llm/providers
POST   /api/v1/admin/llm/providers
PUT    /api/v1/admin/llm/providers/{id}
POST   /api/v1/admin/llm/providers/{id}/test
GET    /api/v1/admin/llm/models
POST   /api/v1/admin/llm/routes
GET    /api/v1/admin/references
POST   /api/v1/admin/references
GET    /api/v1/admin/templates
POST   /api/v1/admin/templates
GET    /api/v1/admin/system/diagnostics
GET    /api/v1/admin/system/storage
GET    /api/v1/admin/system/migrations
```

LLM 설정 수정은 새 Config Version의 트랜잭션 Commit 후 Gateway 캐시에 반영한다. 저장 실패 시 기존 설정을 유지한다. API 응답에 복호화한 API Key를 포함하지 않는다.

## 기능 상세화 시 확정할 항목

다음은 원문 기능에 필요하지만 엔드포인트·요청 형식까지 지정되지는 않은 사항이다. 위 목록을 구현된 기능 전체의 확정 API로 간주하지 않는다.

| 항목 | 확정할 내용 |
| --- | --- |
| 리비전 충돌 | 기대 버전 전달 방식, 충돌 응답, 사용자 재검토 절차 |
| 멱등성 | 적용 API, 키 범위, 보존기간, 같은 키에 다른 입력을 보낸 경우의 처리 |
| 장기 작업 | 시작 응답과 Run 연결, 재시도·취소·사용자 확인 대기 전환 |
| 문서 재처리 | 페이지 단위 범위와 분석 프로필 지정 |
| 프로젝트 관리 | 복제·보관·복원·파일 교체·보존기간 동작의 API 표현 |
| 라이브러리 | 버전·태그·분류·상태·디렉터리 가져오기·공용 등록 API |
| PPT 편집 | 다중 슬라이드 범위, 추가·삭제·복제·정렬, 변경 적용·취소·복원 API |
| Admin | 모델 등록, 라우팅 조회·수정, 기능별 테스트, 백업 상태의 상세 API |
| SSE | 공통·Run별 스트림 범위, 이벤트 형식과 이어받기 |

기능 요구사항은 [사용자 기능](03-product-features.md), [LLM Admin](06-llm-admin.md), [UI 설계](07-ui-design.md)를 기준으로 유지한다.

## 구현된 공용 Space API

현재 제품 원본 등록·관리 API는 `/api/v1/space/{kind}`를 사용하며 kind는 `references` 또는 `templates`다. 목록/등록, 개별 조회/조건부 수정/논리 삭제, `/versions` 조회/추가, `/download?version=N` 원본 다운로드와 `/api/v1/space/uploads/{key}` 상태/취소를 제공한다. multipart Idempotency-Key와 파일 교체 X-Expected-Version, DTO·한도·오류는 [현재 HTTP 계약](../dev-docs/04-data-api.md)에 정의한다. 위 목표 검색/추천/Admin 경로와 현재 원본 관리 경로를 혼동하지 않는다.

공용 전체 목록은 `GET /api/v1/space/all`로 제공한다. 종류별 목록과 같은 검색·상태·페이지 조건을 적용하고 각 항목에 실제 kind를 반환한다. all은 쓰기 대상이 아니다.

## 현재 Provider 구현 범위

Admin Provider 생성은 클라이언트 UUID와 `PUT /api/v1/admin/llm/providers/{id}`, expected_version=0을 사용한다. 수정은 현재 expected_version을 요구하며 불일치하면 409를 반환한다. 목록·상세 GET, 모델 조회 GET `/{id}/models?expected_version=N`, 진단 POST `/{id}/test`, 최근 이력 GET `/{id}/requests`를 제공한다. 나머지 Admin 경로는 요구사항이며 구현 여부는 [현재 API 계약](../dev-docs/04-data-api.md#provider-설정진단-api)을 기준으로 한다.

Provider 설정 UI의 공급원은 `GET /api/v1/admin/llm/provider-types`다. 응답의 id·label·protocol·base·model·structured·key·structured_reason은 model_registry의 단일 카탈로그를 투영한다. 저장된 연결이나 실측 모델 capability와 구분하며, 기존 Provider API는 유지한다.


### 현재 Decision 평가

`POST /api/v1/admin/decisions/{id}/evaluate`는 생성 진단 API와 분리된 앱 내부 판정 진입점이다. 연결 설정 저장은 기존 Provider API를 재사용하되 카탈로그의 LLM/System One 범주로 구분한다. OpenAI/Gemini 판정도 이 경계로 정규화한다. 입력 한도·choice 부분집합·오류·비영속 결과는 [현재 데이터/API 계약](../dev-docs/04-data-api.md#decision-설정과-평가-api)을 따른다. 문서 Workflow API 또는 업로드 자동 분석 완료를 의미하지 않는다.

## 사용자 경험 적용 범위

기존 기계용 코드·필드·리비전 계약은 유지한다. 프론트엔드는 이를 사용자용 상태·복구 안내로 변환하고 원시 오류 객체를 그대로 출력하지 않는다. 사용자 원문을 대상으로 한 일괄 용어 치환은 하지 않는다. 공통 기준은 [일반 사무직을 위한 사용자 경험 계약](07-ui-design.md#일반-사무직을-위한-사용자-경험-계약)을 따른다.

## 연결별 요청 처리 설정

GET/PUT /api/v1/admin/llm/providers/{id}/capacity로 연결별 동시 처리·대기열·대기 시간을 조회·수정한다. PUT의 expected_version은 모델 설정 버전이 아닌 처리 설정 버전이다. 응답의 active/queued는 실제 현재 수치다. 포화 요청은 429, 대기 시간 초과는 504로 구분한다. 상세 필드와 범위는 dev-docs/04-data-api.md의 AI 연결별 처리 설정 API를 따른다.

## 저장 전 모델 목록 조회

`POST /api/v1/admin/llm/models/discover`는 `provider_type`, 선택적 `base_url`, `api_key`, `clear_secret`을 받는다. 기존 연결을 사용할 때는 `connection_id`와 `expected_version`을 함께 보낸다. 성공 응답은 모델 ID 문자열 배열이다. 모델 ID를 먼저 요구하지 않는다. 신규 연결에는 주소가 필요하고, 인증이 필요한 Provider에는 키가 필요하다. 기존 연결은 빈 주소·생략한 키를 현재 버전에서 읽되 목적지나 Provider를 바꿀 때 저장된 키를 자동 재사용하지 않는다.

조회는 설정/리비전/요청 이력 행을 생성하지 않으며 응답은 `Cache-Control: no-store`다. 서버 전체에서 동시 4개로 제한하고 초과는 `429 provider_busy`, 각 외부 조회는 최대 30초다. 기존 연결의 조회는 연결별 대기·동시성 제한도 따른다. 잘못된 필드·주소는 400, 설정 충돌은 409, 외부 인증·응답 오류는 기존 Provider 오류 계약을 따른다. Redirect·proxy·자동 재시도는 사용하지 않으며 페이지 수·모델 수(최대 1000)·응답 크기 제한을 유지한다. 브라우저 취소는 늦은 결과를 버리며 서버 측 종료는 shutdown/timeout에 의해 보장된다.

## 레퍼런스 재사용 자료 API

- `GET /api/v1/document-jobs/{id}/materials`: `kind=all|slides|visual|text`, 선택적 `page`, 최대 80자 `q`, `offset`으로 조회한다. 한 번에 50개와 total을 반환한다. 장표·그림 검색은 해당 페이지의 본문 문맥도 포함한다.
- `POST /api/v1/document-jobs/{id}/materials/resolve`: `material_ids`에 서로 다른 ID 1~50개를 넣으면 요청 순서대로 해석한다. 저장·PPT 생성·LLM 호출 없이 현재 화면의 선택 미리보기와 후속 생성 입력 계약을 제공한다.

응답 schema_version은 1이며 reference_id, file_version, job_id, extraction_id, source_sha256, native bundle hash와 자료 목록을 포함한다. 자료는 page_id, 원본 페이지, 종류, canonical content_block_id 또는 native locator, 미리보기와 그 범위(item/page/none)를 가진다. 네이티브 locator는 원본 slide part·shape IDs·image part·패키지 내 이미지 경로다. 일반 UI에는 이 기술 필드를 표시하지 않는다.

다른 원본 추출의 ID, 삭제한 자료, 템플릿 job은 404다. 빈 선택·중복 ID·50개 초과·잘못된 종류는 422다. 같은 원본/프로필의 불변 추출은 재사용하되 응답의 reference/job/file version은 요청 대상에 고정한다. 원본 교체 후에도 이전 job을 명시하면 이전 버전을 읽을 수 있고, 선택한 자료가 조용히 최신 파일로 바뀌지 않는다. 파생 파일 다운로드는 해당 job에 연결된 Blob만 허용한다.

V11은 `document_native_packages`와 `document_materials`를 추가한다. 원문을 복사하지 않고 content_blocks와 page/extraction 복합 외래 키로 연결한다. Document Extraction schema 2가 재사용 인덱스를 가지며 schema 1은 그대로 판독한다. 구버전 원본을 재추출하려면 명시적인 준비 요청이 필요하다.


## 구현된 Studio 원본 경로

프로젝트 원본의 실제 경로는 `/api/v1/projects/{project}/files` 및 하위 `/{id}`, `/{id}/versions`, `/{id}/download`, `/{id}/processing`, `/{id}/processing/history`다. `/source-review`는 현재 파일/추출 snapshot을 GET하고 같은 snapshot을 PUT하여 명시적 확인한다. `/guide`는 선택적 Do/Don’t를 읽고 기준 버전으로 새 리비전을 저장한다. 파일 등록/교체는 UUID Idempotency-Key와 조건부 버전을 사용하며 프로젝트 scope가 다르면 같은 파일 ID나 요청 키를 재사용할 수 없다. 구체적인 DTO/오류/현재 구현 경계는 [데이터와 HTTP 계약](../dev-docs/04-data-api.md#studio-원본가이드-api)을 따른다.


## 관계 검색 구현 경로

프로젝트 하위 related-searches(생성/최근 조회), related-searches/{id}(상태), results(문서/내용 페이지), retry/cancel(버전·요청 키 명령), related-candidates/{id}/origins(출처 페이지), related-items(참고 선택)을 제공한다. Admin의 /api/v1/admin/related-search/settings는 연결 선택을 조건부 저장한다. 입력/출력과 현재 한도는 [데이터·HTTP 계약](../dev-docs/04-data-api.md#관계-검색-저장api-계약)이 소유한다. 검색 시작·재개·선택을 서로 다른 명령으로 구분한다.


### Space 통합 검색

`GET /api/v1/search`는 q, scope(all/references/templates), mode(all/files/content), archived, offset을 받는 읽기 전용 API다. 회사 공용 Space 등록의 최신 버전만 대상으로 하며 프로젝트 원본은 제외한다. 반환된 job_id/page_id를 상세 화면에 전달해 조회 기준을 유지한다. 상세 제한과 결과 계약은 [구현 데이터/API 문서](../dev-docs/04-data-api.md#space-통합-검색-api)에 정의한다.


### 목차·콘텐츠 작성 API

프로젝트별 `/api/v1/projects/{id}/outline` GET/PUT, `/confirm` POST, `/revisions` 및 `/revisions/{revision}` GET, `/blocks` GET, `/runs` POST와 `/runs/{run}/cancel|retry` POST를 제공한다. 저장/확정은 expected_version, 생성은 입력·모델 version과 Idempotency-Key를 검증한다. 상세 제한·응답·수명은 [구현 데이터/API 계약](../dev-docs/04-data-api.md#목차콘텐츠-리비전과-작업)에 정의한다.

### 검색 근거 문맥

GET `/api/v1/projects/{project}/related-candidates/{id}/evidence`는 후보의 읽기 범위와 함께 비교한 출처를 반환한다. 검색 실행에는 선택적 exploration 상태가, Admin 자료 찾기 설정에는 선택적 planner_connection_id가 추가된다. 일반 `/api/v1/search`는 Space 범위와 모델 호출 없는 조회 계약을 유지한다.

### 현재 PPT 생성 API 경계

실제 대화 수정은 `GET/POST /api/v1/projects/{p}/presentations/{run}/slides/{slide}/edits`와 `POST /api/v1/projects/{p}/slide-edits/{edit}/{apply,reject,retry,cancel}`을 사용한다. 작성 범위는 제목·본문·메모이며 base version·모델 설정 버전·Idempotency-Key로 접수/적용을 보호한다. 실제 상태·오류·저장 관계는 [V20 계약](../dev-docs/04-data-api.md#v20-슬라이드-대화-수정)을 따른다.

실제 준비·생성 API는 프로젝트 범위의 `/projects/{p}/presentation-preparation`과 `/projects/{p}/presentations` 아래에서 제공한다. 현재 `{run}`은 생성 작업 및 성공한 결과 revision ID이며, 응답의 `presentation_id`는 동일 발표자료의 여러 결과를 묶는 식별자다. 준비 상태·확정, 템플릿 선택, 생성·재시도·취소, 장표·근거·PNG·PPTX 다운로드의 정확한 경로와 본문은 [V19 데이터/API](../dev-docs/04-data-api.md#v19-발표자료-준비생성)를 따른다. 위 목표 설계의 전역 `/presentations/{id}`·웹 채팅 편집·범용 Workflow SSE 경로를 완료된 API로 간주하지 않는다.
