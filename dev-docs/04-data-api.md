# 데이터와 HTTP 계약

## 저장 경계

| 데이터                                   | 현재 위치                       | 지속성                                    |
| ---------------------------------------- | ------------------------------- | ----------------------------------------- |
| 목업 프로젝트·문서 등록·가이드·목차·deck | 브라우저 Store                  | 새로고침 시 초기화                        |
| 채팅·draft·선택·undo/redo                | 기능별 메모리 상태              | 현재 페이지 세션                          |
| 삽입 이미지                              | 메모리 data URL, 내보낸 JSON    | 앱 서버에는 저장하지 않음                 |
| 서버 저장 구조                           | 개발 시 저장소 루트의 `./data/` | SQLite DB·Migration 전 백업·디렉터리·잠금 |
| QA 결과·브라우저 임시 파일               | `mock/helpers/.artifacts/`      | 개발 도구 산출물                          |
| 화면 캡처                                | `mock/captures/folio/`          | 개발 자료                                 |
| 제품 테스트 임시 데이터                  | `tests/.artifacts/`             | 테스트 수명에 종속                        |

`db/app.sqlite`에는 프로젝트, 공용 Reference/Template, 파일·Blob 메타데이터, 업로드 receipt와 refinery Migration 이력이 저장된다. 원본 바이트는 Content-addressable Blob Store에 저장한다. 아래 인메모리 모델은 별도 목업이며 제품 Space 계약은 문서 하단에서 설명한다. 프로젝트 원본과 Do/Don’t 가이드는 서버에 저장하며 목차·PPT 서버 저장은 아직 없다.

## 인메모리 모델

다음은 소스의 주요 필드를 요약한 것이며 서버 스키마나 공개 직렬화 규격이 아니다. 초기 값은 [data.js](../mock/js/data.js)가 정의한다.

| 객체           | 주요 필드                                                                                     | 역할                               |
| -------------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| Store          | `projects`, `runs`, `providers`, `routes`, `session`, `spaceAssets`                           | 세션의 업무 상태                   |
| Project        | `id`, `name`, `documents`, `guides`, `outlines`, `outlineVersion`, `decks`, `history`         | 프로젝트별 데이터 구분             |
| 문서 등록      | `id`, `name`, `extension`, `size`, `pages`, `status`, `sample`, `at`                          | 파일 메타데이터                    |
| 가이드         | `schema_version`, `version`, `do`, `dont`, `at` 등                                            | 작성 방향의 저장 기록              |
| 목차 노드      | `id`, `title`, `blockIds`                                                                     | 블록 참조 기반 매핑                |
| Deck           | `id`, `title`, `guideVersion`, `outlineVersion`, `template`, `version`, `slides`, `revisions` | 프레젠테이션 상태와 전체 스냅샷    |
| Slide          | `id`, `version`, `title`, `body`, `layout`, `evidence`, `objects`, `textStyles`               | HTML 슬라이드 구성                 |
| 삽입 객체      | `id`, `type`, `x`, `y`, `w`, `h`, 텍스트·이미지·서식 속성                                     | 편집 가능한 객체                   |
| 원본 삽입 계획 | `insertions` 또는 `sourceInsertions`                                                          | deck 또는 slide에 고정한 자료·버전 |

원문 샘플은 `blocks`를 참조한다. 영속 Foreign Key, 유일성 제약, 프로젝트 간 서버 접근 제어는 존재하지 않는다. 샘플 ID는 데이터베이스 ID 정책을 대신하지 않는다.

## 파일 입력

[uploads.js](../mock/js/uploads.js)는 확장자, 크기, 개수, 빈 파일 여부를 검사한다.

| 경로                    | 허용 입력                        | 제한                                      | 읽는 내용                  |
| ----------------------- | -------------------------------- | ----------------------------------------- | -------------------------- |
| 프로젝트 문서·참고 문서 | PDF, HWP, HWPX, DOCX, PPTX, XLSX | 한 번에 10개, 파일당 50 MiB, 빈 파일 거부 | 이름·크기                  |
| Space 레퍼런스          | 지원 문서 형식                   | 공통 업로드 제한                          | 이름·크기                  |
| Space 템플릿            | PPTX                             | 공통 업로드 제한                          | 이름·크기                  |
| 캔버스 이미지           | PNG, JPEG, WebP                  | 2 MiB, 1,600만 화소                       | 디코딩된 이미지와 data URL |

문서의 확장자 검사는 실제 MIME·파일 구조·악성 콘텐츠 검사와 다르다. 목업 문서 등록에는 원본 파일 보존·다운로드 계약이 없으며, 화면에 제공되는 샘플 원문은 업로드한 파일의 보존 사본이 아니다.

## JSON 내보내기

[dialogs.js](../mock/js/dialogs.js)의 `exportDeck`은 다음 필드를 구성한다. 다운로드 명령은 브라우저 Blob과 Object URL을 사용한다.

| 필드                                 | 의미                           |
| ------------------------------------ | ------------------------------ |
| `schema_version`                     | 현재 목업 내보내기 값 `1`      |
| `mock`                               | `true`                         |
| `title`                              | 프레젠테이션 이름              |
| `guide_revision`, `outline_revision` | 생성 시 사용한 버전 번호       |
| `template`                           | 템플릿 식별자                  |
| `version`                            | 현재 deck version              |
| `source_insertions`                  | deck 수준 삽입 계획            |
| `slides`                             | 현재 슬라이드 상태와 삽입 객체 |

파일명은 `PuPuTyX-mock-presentation.json`이다. 이미지가 있으면 해당 data URL도 포함된다. 전체 리비전 이력과 채팅 이력은 내보내지 않는다. JSON 재가져오기, 스키마 변환기, PPTX 변환은 없다.

## 구현된 HTTP 엔드포인트

서버 라우트의 원본은 [HTTP router](../backend/src/adapters/http/mod.rs)다.

| 메서드·경로                            | 응답                                    |
| -------------------------------------- | --------------------------------------- |
| `GET /`                                | `/home`으로 307 임시 이동               |
| `GET /healthz`                         | 200, 서비스 식별 정보 JSON              |
| `GET /home`, `/home/`, `/home/{*path}` | `embedded-ui` 빌드에서 정적 UI 또는 SPA |
| 등록되지 않은 경로                     | 404, `not_found` JSON                   |

`GET /healthz` 예시:

```json
{
  "status": "ok",
  "service": "PuPuTyX",
  "version": "0.1.0"
}
```

`version`은 빌드한 Cargo 패키지 버전이다. Health는 DB·스토리지 무결성·외부 도구·Provider를 진단하지 않는다. 서버가 응답한다는 것과 업무 수행 준비가 되었다는 것은 별개다.

등록되지 않은 API 경로의 응답:

```json
{
  "code": "not_found",
  "message": "The requested resource does not exist."
}
```

`embedded-ui`가 없으면 `/home`은 503과 Vite 실행 안내를 반환한다. 포함된 UI에서는 `/home/assets/` 또는 파일 확장자가 있는 경로의 자산이 없으면 SPA 대신 404를 반환한다. 정적 응답은 MIME 유형과 `Cache-Control: no-cache`를 설정한다.

프로젝트·문서 처리·Provider·Studio·PPT API는 아래 각 절의 계약으로 구현되어 있다. 범용 Workflow API와 SSE는 아직 구현되지 않았다. [REST API 요구사항](../blueprint/08-rest-api.md)의 나머지 경로를 구현된 API로 간주하지 않는다.

## React Health 요청

[api.ts](../frontend/src/lib/api.ts)는 동일 출처 `/healthz`를 호출한다. Query의 취소 신호와 5초 timeout을 결합하고 HTTP 성공 여부와 Zod 스키마를 검사한다. Query 기본값은 30초 stale time, 재시도 1회, 창 포커스 시 자동 재조회 비활성화다.

운영 데이터 모델, Blob 무결성·정규화·리비전의 요구사항은 [데이터 설계](../blueprint/05-data-storage.md)에 별도로 정의되어 있다.

## 실제 공유 프로젝트 API

로그인·쿠키·Authorization은 필요하지 않으며 모든 접속자에게 같은 데이터가 반환된다. JSON body 최대 크기는 4,096 bytes다. 성공·오류 응답은 `Cache-Control: no-store`를 사용한다.

| 경로                           | 요청                                                                                                                                                                                                | 응답                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `GET /api/v1/projects`         | `q` 80자 이하, `limit` 1~100(기본 50), `offset` 0~1,000,000, `status=active/archived/all`(기본 active), `sort=recent/name/deadline`(기본 recent), 선택 `due_date=YYYY-MM-DD` (선택한 마감일과 일치) | 200, `{items,total,limit,offset}`  |
| `GET /api/v1/projects/{id}`    | 프로젝트 UUID                                                                                                                                                                                       | 200, Project 또는 404              |
| `POST /api/v1/projects`        | UUID `Idempotency-Key`, `{name,due_date}`                                                                                                                                                           | 신규 201, 동일 요청 재시도 200     |
| `PATCH /api/v1/projects/{id}`  | `{name,expected_version}` 또는 `{status,expected_version}` 중 하나                                                                                                                                  | 200, Project; 충돌 409             |
| `DELETE /api/v1/projects/{id}` | `{expected_version}`                                                                                                                                                                                | 200, 논리 삭제된 Project; 충돌 409 |

Project 응답은 `id`, `name`, `due_date`, `status`, `deleted_at`, `version`, `created_at`, `updated_at`이다. 시간은 Unix epoch milliseconds, version은 양의 정수다. `due_date`는 시간대 없는 `YYYY-MM-DD`이며 생성 시 1900~9999년의 유효한 Gregorian 날짜를 요구한다. 기존 데이터는 null을 유지한다. 삭제 전 `deleted_at`은 null이다.

이름은 앞뒤 공백을 제거한 1~80 Unicode 문자이며 제어 문자를 거부한다. 같은 이름도 허용한다. 이름 검색은 literal substring이며 ASCII 대소문자를 구분하지 않는다. Home은 단일 마감일을 선택하여 해당 날짜에 마감되는 프로젝트를 조회한다. 마감일순에서는 미정이 마지막이다. 모든 정렬은 ID로 동률을 해소한다. 조회의 count와 페이지는 같은 읽기 트랜잭션에 속한다.

생성 키는 공유 키 공간에 영속 보관하고 자동 만료하지 않는다. 같은 키·정규화된 이름·마감일은 같은 ID의 현재 상태를 반환한다. 다른 입력은 `idempotency_conflict` 409다. 삭제된 프로젝트에 대한 생성 재시도는 404이며 다시 만들지 않는다. V1 키는 당시 마감일이 없던 요청 기록으로 유지한다.

이름·상태 변경과 삭제는 정확한 `expected_version`을 요구한다. 충돌은 `revision_conflict` 409이며 강제 덮어쓰기는 없다. 같은 version에서 같은 이름/상태 저장은 version을 증가시키지 않는다. 삭제는 `deleted_at`을 기록하고 version을 증가시킨다. 바로 이전 version으로 같은 삭제를 재시도하면 동일 결과를 반환한다. 삭제된 행은 모든 목록·상세 조회에서 제외하며 보관 복원으로 되살릴 수 없다.

오류는 `{code,message}` 형식이다. 입력 검증은 422, 잘못된 query·요청 키는 400, 없는/삭제된 프로젝트는 404, 큐 포화·종료는 503이다. JSON 파싱·크기 제한도 JSON 오류로 전달한다. SQL·파일 경로·원문 요청은 API 오류에 노출하지 않는다.

[V3 Migration](../backend/migrations/V3__project_due_date.sql)은 `projects.due_date`와 `project_creation_requests.original_due_date`로 이름을 통일한다. 프로젝트에는 마감일 하나만 존재하며 시작일/종료일 쌍은 없다. 생성 요청의 날짜는 멱등성 비교에 필요한 당시 입력으로, 현재 프로젝트 날짜의 별도 원본이 아니다. V1/V2 SQL은 변경하지 않으며, 기존 DB를 백업하고 날짜·version·상태·삭제 시각·요청 키를 보존한다.

API v1 호환 경계에서 이전 `end_date` 생성 입력도 같은 `due_date`로 파싱한다. 응답의 `end_date`는 같은 값의 호환 별칭이며 DB에는 중복 저장하지 않는다. 예전 `from/to` 조회 파라미터는 범위 검색 호환용으로만 지원하고 Home에서는 사용하지 않는다. canonical 마감일 조건과 함께 전송하면 모든 조건의 교집합을 반환한다. 두 생성 필드 이름을 동시에 보내는 모호한 요청은 거부한다.

삭제의 물리 정리·보존기간 자동화·전체 프로젝트 복제·전체 변경 이력은 미구현이다. 프로젝트 문서는 아래 Studio 계약을 따른다.

## Space 제품 데이터·API

[V4 스키마](../backend/migrations/V4__space_libraries.sql)는 `file_blobs`, `file_registrations`, `reference_items/versions/tags/tag_links`, `template_items/versions/tags/tag_links`, `upload_requests`를 추가한다. 기존 프로젝트·배포된 Migration은 변경하지 않는다. SHA-256으로 바이트를 식별하며 같은 바이트를 여러 라이브러리에서 등록해도 물리 Blob은 하나다. 파일 등록·이름은 별도 행이고 현재 버전은 같은 item의 버전만 참조하도록 복합 FK로 검증한다.

`kind`는 `references` 또는 `templates`다. 모든 경로의 prefix는 `/api/v1/space`다.

| 경로                         | 계약                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /{kind}`                | `q`, `status=active                                                                      | archived | all`, `limit`1–100(기본 12),`offset`0–1,000,000;`{items,total}` |
| `POST /{kind}`               | multipart `file` 1개, 선택 `title`, JSON 배열 문자열 `tags`; UUID `Idempotency-Key` 필수 |
| `GET /{kind}/{id}`           | 현재 자산 DTO                                                                            |
| `PATCH /{kind}/{id}`         | `{title,tags,expected_version}` 또는 `{status,expected_version}`                         |
| `DELETE /{kind}/{id}`        | JSON `{expected_version}`; 논리 삭제                                                     |
| `GET /{kind}/{id}/versions`  | 불변 파일 버전 배열                                                                      |
| `POST /{kind}/{id}/versions` | 같은 multipart 계약과 `X-Expected-Version` 필수; 새 파일 버전 추가                       |
| `GET /{kind}/{id}/download`  | 최신 원본; `?version=N`은 지정 버전. attachment·UTF-8 파일명·nosniff·no-store            |
| `GET /uploads/{key}`         | `{state,item_id}`; receiving/failed/cancelled/complete                                   |
| `DELETE /uploads/{key}`      | 취소 결과 확정. 사전 취소는 tombstone, 이미 완료면 complete 유지                         |

자산 DTO는 `id,title,tags,status,version,file_version,filename,sha256,size_bytes,mime,format,created_at,updated_at,processing`이다. 시간은 epoch 밀리초다. `version`은 공유 수정 CAS, `file_version`은 원본 파일 순번이다. `processing`은 현재 파일 버전의 최신 처리 작업 상태이며 미처리 기존 파일만 `not_started`다. 버전 DTO는 `number,filename,sha256,size_bytes,mime,created_at`이다.

신규 등록 201, 동일 입력·키 재전송 200이다. 동일 키의 kind/target/기준 버전/메타데이터/파일명/해시가 다르면 409이며 변경·등록 중·취소 충돌도 409다. 현재 입력 조건 위반은 422, 파일 크기 초과 413, 자원 포화 503, 공간 부족 507, 저장 오류 500이다. 서버는 내부 경로나 원문을 오류 응답에 넣지 않는다. JSON 변경 body는 4 KiB, 각 multipart 메타 필드는 4 KiB, 전체 body는 50 MiB + 64 KiB다. 이름은 1–120자, 태그는 12개·각 24자, 검색은 80자까지다.

클라이언트 큐는 20개, 동시 전송 2개, 서버 파일 처리도 2개다. 요청은 300초 제한이며 시작 시 여유 공간 116 MiB를 검사한다. 공간 검사는 예약·할당 보장이 아니므로 실제 write 실패도 처리한다. ZIP은 4,096항목, 항목 64 MiB, 해제 합계 250 MiB, 압축률 1,000을 제한하고 실제 읽은 크기를 검사한다. 경로 탈출·symlink·중복/겹침 항목·알려진 VBA payload를 거부한다. OOXML Content Types는 UTF-8·허용 namespace/part/type과 DTD 금지를 검사한다. HWP는 5.x FileHeader, HWPX는 mimetype·필수 항목, PDF는 파싱·암호화 여부·1–2,000페이지를 검사한다. 이는 악성코드 검사나 모든 Office 표준·본문 검증을 의미하지 않는다.

파일은 `blobs/.staging`에서 스트리밍·해시 계산 후 같은 파일시스템의 `blobs/sha256/aa/bb/<hash>`에 덮어쓰기 없이 게시한다. 파일과 디렉터리 동기화 후 DB를 확정한다. 중단된 receiving receipt는 재시작 시 failed로 바꾸고 소유한 staging 파일만 정리한다. 확정 전 남은 고아 Blob은 아래의 시작 시 수거 정책으로 정리한다. 논리 삭제된 원본·리비전의 물리 폐기와 외부 라이브러리 경로 override는 미구현이다. 원본·버전은 논리 삭제 후에도 물리 보존한다.

### 통합 Space 목록

`GET /api/v1/space/all`은 두 라이브러리를 같은 DB snapshot에서 조회한다. 기존 목록과 같은 q/status/limit/offset을 받고 전체 개수와 최신 변경순 통합 페이지를 반환한다. 정렬 동률은 id, kind 순서로 해소한다. 모든 자산 DTO에 추가한 `kind=references|templates`가 실제 등록·수정·버전·다운로드 경로를 결정한다. `/all`은 목록 조회 전용이며 생성/변경 대상으로 사용하지 않는다. 기존 DB 형식과 파일 지원 범위는 변경하지 않는다.

### HTML 원본 계약

레퍼런스 등록과 새 파일 버전에 `.html`/`.htm`을 허용한다. 확장자 대소문자를 구분하지 않으며 format은 `html`, MIME은 `text/html`이다. 템플릿은 계속 PPTX만 받는다. 기존 스키마에 format 값을 추가하므로 Migration은 필요하지 않다.

UTF-8(BOM 허용), 최대 50 MiB의 원본 바이트를 보존한다. HTML5 tokenizer가 인식한 시작 태그 또는 HTML doctype을 요구하고 복구 가능한 태그 생략을 허용한다. 알려진 다른 바이너리 형식, NUL/비텍스트 제어 바이트, 잘못된 UTF-8, markup 없는 텍스트/주석은 422로 거부한다. UTF-8 오류는 저장 인코딩을 바꿔 재시도하라는 문구를 제공한다. 토큰 1,000,000개·태그당 속성 4,096개를 초과하면 422로 문서 분할을 안내한다. 이 검사는 악성 HTML 제거·완전한 문법 검증이 아니다.

다운로드는 `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`와 함께 `Content-Security-Policy: sandbox; default-src 'none'; base-uri 'none'; form-action 'none'`를 반환한다. 앱은 HTML 본문을 DOM/iframe에 삽입하거나 URL을 가져오지 않는다. 저장한 원본을 사용자가 외부 프로그램에서 여는 동작은 이 서버 응답 정책과 별개다. HTML 미리보기·본문 검색·변환은 미구현이다.

## Provider 설정·진단 API

[V5 Migration](../backend/migrations/V5__model_registry.sql)은 `llm_provider_connections`, `llm_provider_config_versions`, `llm_requests`를 추가한다. 설정의 이름·주소·모델·활성 여부·timeout·암호문은 버전 행이 소유하고 연결 행은 현재 버전 포인터만 보관한다. 과거 설정은 수정하지 않는다. 연결 삭제 대신 비활성화를 제공한다.

| Method / 경로                                                    | 구현 계약                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GET `/api/v1/admin/llm/provider-types`                           | 설치된 Provider 카탈로그: id·label·protocol·base·model·structured·key·structured_reason |
| GET `/api/v1/admin/llm/providers`                                | 공용 연결 목록, API Key는 has_secret만 제공                                             |
| GET `/api/v1/admin/llm/providers/{id}`                           | 최신 저장 설정                                                                          |
| PUT `/api/v1/admin/llm/providers/{id}`                           | 클라이언트 UUID, expected_version=0으로 생성, 이후 현재 버전으로 수정                   |
| GET `/api/v1/admin/llm/providers/{id}/models?expected_version=N` | 저장된 활성 설정의 서버 모델 ID 목록                                                    |
| POST `/api/v1/admin/llm/providers/{id}/test`                     | expected_version + kind(text/structured), 샘플 응답과 요청 식별자                       |
| GET `/api/v1/admin/llm/providers/{id}/requests`                  | 최신 20건, 설정 버전 ID·상태·소요 시간·usage·오류 코드                                  |

PUT 필드는 name, provider_type(openai/claude/gemini/lm_studio_native/llama_cpp/sglang/vllm/litellm/lm_studio/openai_compatible), base_url, model_identifier, timeout_seconds(5~180), enabled, expected_version이다. api_key 생략은 기존 값 유지, 새 문자열은 교체, clear_secret=true는 삭제다. 키 유지 상태에서 Base URL 또는 Provider 종류를 변경하려면 키를 다시 입력하거나 삭제해야 한다. endpoint에 키·쿼리·fragment를 넣을 수 없다.

동일 UUID 재사용과 조건부 버전으로 중복 연결 생성·조용한 덮어쓰기를 방지한다. 응답 유실 뒤 같은 요청을 다시 보내면 409가 될 수 있으므로 최신 설정을 조회하고 사용자에게 적용 여부를 검토시킨다. 버전 충돌 시 폼 입력을 보존한다. 설정 저장은 외부 모델 호출이나 문서 재분석을 시작하지 않는다.

JSON 입력 오류 400, 없는 연결 404, 설정 충돌 409, 미지원 기능 422, 동시 호출 한도 429, 모델 서버 인증/HTTP/형식 오류 502, timeout 504, 저장소/종료 오류 503을 사용한다. 요청 body 최대 16 KiB, 모델 응답 최대 512 KiB, 동시 외부 호출과 대기 요청은 연결별 처리 설정을 따르며 일반 API 호출의 자동 재시도는 없다. 응답은 no-store다.

text 테스트는 `PuPuTyX connection OK` 응답을, structured 테스트는 status가 ok인 단일 JSON 객체를 검증한다. 서버가 분리한 reasoning_content는 공개하지 않는다. 요청 이력에는 프롬프트·결과 본문·API Key를 저장하지 않는다. 모델 목록 조회 성공은 Vision·Tool Calling·추론 가능 여부의 증명이 아니다.

### 네이티브 Provider 계약

| provider_type                | Base URL 예                                      | 모델 조회 / 생성                        | 구조화 생성                         |
| ---------------------------- | ------------------------------------------------ | --------------------------------------- | ----------------------------------- |
| openai                       | https://api.openai.com/v1                        | models / responses                      | text.format.json_schema             |
| claude                       | https://api.anthropic.com/v1                     | models / messages                       | output_config.format                |
| gemini                       | https://generativelanguage.googleapis.com/v1beta | models / models/{id}:generateContent    | generationConfig.responseJsonSchema |
| lm_studio_native             | http://127.0.0.1:1234/api/v1                     | models / chat                           | 미지원, 422                         |
| llama_cpp                    | http://127.0.0.1:8080                            | v1/models / apply-template → completion | json_schema                         |
| sglang                       | http://127.0.0.1:30000                           | get_model_info / tokenize → generate    | sampling_params.json_schema 문자열  |
| vllm                         | http://127.0.0.1:8001/v1                         | models / chat/completions               | response_format                     |
| litellm                      | http://127.0.0.1:4000/v1                         | models / chat/completions               | response_format                     |
| lm_studio, openai_compatible | 서버의 /v1 경로                                  | models / chat/completions               | 기존 명시적 호환 연결               |

클라우드 연결은 키가 없으면 요청 전에 인증 오류를 반환한다. OpenAI·Claude는 Bearer, Gemini는 x-goog-api-key 헤더를 사용하고 URL에는 키를 넣지 않는다. Claude는 anthropic-version=2026-10-21을 고정하며 temperature/top_p/top_k를 보내지 않는다. 현재 Claude는 workspace에 한정된 API Key 구성이 대상이다. 별도 workspace 선택·OAuth·클라우드 IAM 인증은 미구현이다.

OpenAI와 LM Studio Native는 store=false로 대화 저장을 요청하지 않는다. LM Studio의 integrations는 빈 배열로 제한한다. 결과는 각 프로바이더의 최종 텍스트 블록만 추출하고 reasoning/thinking/thought 블록은 공개하지 않는다. 차단·거절·토큰 한도에 따른 미완료 결과는 실패로 처리한다. usage는 서비스가 반환한 토큰 수이며 비용 추정값이 아니다.

Claude·Gemini 모델 목록의 pagination은 최대 10페이지·1000개와 전체 요청 timeout으로 제한한다. Gemini는 generateContent 지원 모델만 표시한다. SGLang은 설정 ID와 실제 model_path를 확인하고 서버의 tokenizer에 chat messages를 보내 입력 토큰을 생성한다. llama.cpp도 서버 chat template을 사용한다. 서버 버전이 해당 endpoint를 제공하지 않으면 명시적으로 실패하며 다른 프로토콜로 우회하지 않는다.

V6는 설정·연결·요청 테이블을 동일 트랜잭션에서 재구성해 Provider CHECK 제약을 확장한다. 기존 UUID·버전·암호문·AAD·요청 참조를 보존한다. 기존 lm_studio 값은 계속 OpenAI 호환을 뜻하고, Native 전환은 새 설정 리비전으로 명시적으로 저장한다.

카탈로그는 서버가 지원하는 어댑터의 코드상 기능과 기본값을 설명한다. 특정 모델의 실측 capability나 저장된 설정/인증 정보가 아니다. UI는 이 endpoint의 목록으로 선택지를 만들고 실행 정책은 동일한 ProviderKind descriptor로 검증한다. 알 수 없는 종류는 입력 오류로 거부한다. 추가 테이블·Migration 없이 기존 문자열 ID와 설정 버전을 유지한다.

## Decision 설정과 평가 API

V7 Migration은 기존 연결·불변 설정·암호문·요청 FK를 유지하면서 8개 native 판정 protocol kind와 `llm_requests.kind=decision`을 추가한다. V1~V6 파일은 변경하지 않는다. 새 카탈로그의 category는 `llm` 또는 `system`이며 saved provider_type에서 유도한다. 설정 저장은 기존 version/CAS·키 교체 규칙을 그대로 사용한다.

`POST /api/v1/admin/decisions/{id}/evaluate`는 `{expected_version, batch: {state, questions}}`를 받는다. 모델 ID·인증·endpoint는 저장된 설정에서 고정한다. batch는 UTF-8 직렬화 32 KiB, 질문 1~16개, 질문별 choice 선택지 2~16개다. ID/선택값은 ASCII 영숫자·밑줄·하이픈 1~64자이며 instructions/설명은 각각 최대 2048 bytes다. state는 문자열·객체·배열이며 이미지를 처리하는 별도 assets/files 필드는 허용하지 않는다. HTTP body 한도는 64 KiB다.

응답은 `{result: {answers, statistics, model}, request}`다. answers는 질문별 `{choice, probabilities, confidence}`이며 일반 LLM 통계는 null, statistics는 unavailable이다. native는 provider_reported이며 선택지별 확률의 범위·합계·선택값과 질문 집합을 검증한다. model은 Provider가 보고한 값이 있으면 그 값, 없으면 고정된 설정 모델 ID다. 일반 LLM 응답은 System One 전체 wire 호환을 주장하지 않는다.

잘못된 입력 400, 없는 연결 404, stale version 409, 미지원 capability 422, admission 초과 429, 모델 응답·연결·인증 오류 502, timeout 504를 반환한다. 부분 성공·자동 fallback·자동 mutation retry는 없다. 호출 실패를 0으로 변환하지 않는다. 프롬프트·결과 본문은 DB나 기본 로그에 저장하지 않으며 요청 종류·설정 참조·상태·시간·제공된 토큰 수만 기록한다. 종료 시 호출을 취소하고 재시작 시 미완료 기록은 interrupted로 복구한다. 브라우저 대기 취소는 서버의 취소 API가 아니다.

## Space 처리 API와 V8 데이터

| API                                                 | 계약                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET /api/v1/space/{kind}/{id}/processing?job={uuid} | 현재 파일의 최신 실행 또는 지정 실행. 작업·페이지·경고·템플릿 결과·템플릿 추출 가능 여부            |
| GET /api/v1/space/{kind}/{id}/processing/history    | 파일 버전별 최신순 실행 이력, 최대 50건                                                             |
| POST /api/v1/space/{kind}/{id}/processing           | 현재 파일의 새 실행. expected_version + UUID Idempotency-Key. 진행 중인 동일 파일 작업이 있으면 409 |
| GET /api/v1/document-jobs/{id}/blocks               | page/q/offset, 최대 50개. 텍스트·표 텍스트·이미지 참조·목차 판정                                    |
| POST /api/v1/document-jobs/{id}/retry 또는 cancel   | 작업 expected_version + Idempotency-Key. 재시도는 완료 체크포인트 재사용                            |
| GET /api/v1/document-jobs/{id}/files/{sha256}       | 해당 실행에 연결된 PNG 또는 패키지 ZIP만 제공. 다른 실행의 임의 Blob 조회 금지                      |
| GET/PUT /api/v1/admin/document-processing/settings  | version, connection_id. PUT은 expected_version으로 충돌 검사                                        |

작업 상태는 queued/extracting/classifying/waiting_configuration/succeeded/failed/cancelled다. UI는 추출에 가짜 비율을 부여하지 않으며, 판정에서는 완료된 텍스트 블록 수/전체 텍스트 블록 수를 사용한다. 미판정과 실패는 0이 아니다. 이미지 블록은 현재 텍스트 판정에서 제외한다.

V8는 processing settings, jobs, command receipts, events, extractions, pages, content_blocks, document_decisions, template_extractions와 FTS5를 추가한다. 기존 원본·파일 버전·Provider 설정·요청 이력은 유지한다. file_blobs에는 생성 PNG/ZIP도 content hash로 등록한다. template bundle에는 원본 PPTX를 중복 포함하지 않고 원본 Blob hash와 재구성 경로를 기록한다.

추출 입력은 기존 50 MiB 업로드 정책을 따르며, 결과는 최대 500 페이지/영역·20,000 블록·16 MiB JSON이다. 블록 텍스트는 UTF-8 기준 6,000 bytes 단위로 분할하고 원문을 잘라 버리지 않는다. 생성 이미지는 파일당 4 MiB, 총 64 MiB/최대 1,000개로 제한한다. 템플릿 번들은 최대 128 MiB다. 도구 실행은 180초, Node JS heap은 1 GiB로 제한한다. 네이티브 메모리/전체 프로세스의 운영 상한은 Pod 자원 제한으로 검증해야 한다.

Worker는 60초 lease와 2초 heartbeat를 사용한다. 일시적 모델 혼잡·timeout·연결/저장소 문제는 최대 3회, 3초×attempt 지연으로 재시도한다. 유효하지 않은 모델 출력이나 손상 파일은 자동으로 0 또는 성공으로 바꾸지 않는다. 명시적 재시도는 새 시도 예산을 열고 추출·판정 체크포인트를 재사용한다. 모델 입력/출력 본문은 llm_requests에 저장하지 않으며 문서의 판정 결과만 document_decisions에 영속화한다.

자료/작업 없음 404, 버전·상태 충돌 409, 잘못된 명령/입력 422, 저장소 문제 503을 반환한다. 소스 및 결과 파일의 물리 삭제/GC, 전체 저장소 백업, 페이지 단위 재추출, Office PDF 정규화는 별도 운영·기능 범위다.

### 템플릿 장표 미리보기

V9 `template_previews`는 `template_extractions.id`에 속하는 순서·PNG Blob·가로·세로를 저장한다. 상세 응답의 `template.previews`는 `ordinal`, `sha256`, `width`, `height`를 제공한다. 파일 API는 해당 작업에 연결된 PNG만 허용하며 다른 작업의 Hash로 접근할 수 없다. V8의 기존 결과는 그대로 유지하며 자동 재추출하지 않는다.

## AI 연결별 처리 설정 API

`GET /api/v1/admin/llm/providers/{id}/capacity`는 `connection_id`, 설정 `version`, `max_parallel`, `queue_capacity`, `queue_timeout_seconds`, 실시간 `active`·`queued`를 반환한다. LLM과 System One에 동일한 계약을 사용한다. Provider의 모델/인증 설정 버전과 독립된 운영 설정이다.

`PUT`은 `expected_version`과 세 가지 한도 필드만 받는다. 설정이 없으면 버전 0과 기본값을 읽고 첫 저장에서 버전 1을 만든다. 숫자 범위·정수·알 수 없는 필드를 검증하며 잘못된 입력 400, 없는 연결 404, 버전 충돌 409를 반환한다. 재전송으로 같은 값이 다시 저장되는 경우도 버전 조건으로 중복 변경을 방지한다.

| 필드                  | 기본값 | 허용 범위 | 의미                                                           |
| --------------------- | ------ | --------- | -------------------------------------------------------------- |
| max_parallel          | 4      | 1~1024    | 이 연결에 동시에 보낼 최대 요청                                |
| queue_capacity        | 32     | 0~4096    | 실행 자리와 별도로 기다릴 수 있는 요청 수; 0이면 대기하지 않음 |
| queue_timeout_seconds | 30     | 1~600     | 실행 자리를 기다리는 최대 시간                                 |

모두 사용 중이고 대기열도 찼으면 `429 provider_busy`, 대기 중 시간이 지나면 `504 provider_queue_timeout`이다. 처리 중 요청은 기존 응답 timeout과 모델 설정을 유지한다. 아직 외부 호출을 시작하지 않은 요청은 `llm_requests`에 실행 중 행을 만들지 않으며 대기 상태는 capacity의 실시간 수치로 확인한다. 실행 이력의 `elapsed_ms`는 대기를 제외한 실행 시간을 나타낸다.

V10 `model_request_capacity`는 연결 외래 키와 단일 최신 설정을 저장한다. 처리 중·대기 중 수는 DB에 중복 저장하지 않는다. 새 API는 no-store이고 설정 저장만으로 모델 호출이나 기존 결과 재생성을 하지 않는다. 브라우저의 모델 호출 timeout은 최대 큐 대기 600초와 해당 연결의 응답 timeout에 여유 5초를 더한 범위로 설정한다.

## 저장 전 모델 목록 조회

`POST /api/v1/admin/llm/models/discover`는 `provider_type`, 선택적 `base_url`, `api_key`, `clear_secret`을 받는다. 기존 연결을 사용할 때는 `connection_id`와 `expected_version`을 함께 보낸다. 성공 응답은 모델 ID 문자열 배열이다. 모델 ID를 먼저 요구하지 않는다. 신규 연결에는 주소가 필요하고, 인증이 필요한 Provider에는 키가 필요하다. 기존 연결은 빈 주소·생략한 키를 현재 버전에서 읽되 목적지나 Provider를 바꿀 때 저장된 키를 자동 재사용하지 않는다.

조회는 설정/리비전/요청 이력 행을 생성하지 않으며 응답은 `Cache-Control: no-store`다. 서버 전체에서 동시 4개로 제한하고 초과는 `429 provider_busy`, 각 외부 조회는 최대 30초다. 기존 연결의 조회는 연결별 대기·동시성 제한도 따른다. 잘못된 필드·주소는 400, 설정 충돌은 409, 외부 인증·응답 오류는 기존 Provider 오류 계약을 따른다. Redirect·proxy·자동 재시도는 사용하지 않으며 페이지 수·모델 수(최대 1000)·응답 크기 제한을 유지한다. 브라우저 취소는 늦은 결과를 버리며 서버 측 종료는 shutdown/timeout에 의해 보장된다.

## 레퍼런스 재사용 자료 API

- `GET /api/v1/document-jobs/{id}/materials`: `kind=all|slides|visual|text`, 선택적 `page`, 최대 80자 `q`, `offset`으로 조회한다. 한 번에 50개와 total을 반환한다. 장표·그림 검색은 해당 페이지의 본문 문맥도 포함한다.
- `POST /api/v1/document-jobs/{id}/materials/resolve`: `material_ids`에 서로 다른 ID 1~50개를 넣으면 요청 순서대로 해석한다. 저장·PPT 생성·LLM 호출 없이 현재 화면의 선택 미리보기와 후속 생성 입력 계약을 제공한다.

응답 schema_version은 1이며 reference_id, file_version, job_id, extraction_id, source_sha256, native bundle hash와 자료 목록을 포함한다. 자료는 page_id, 원본 페이지, 종류, canonical content_block_id 또는 native locator, 미리보기와 그 범위(item/page/none)를 가진다. 네이티브 locator는 원본 slide part·shape IDs·image part·패키지 내 이미지 경로다. 일반 UI에는 이 기술 필드를 표시하지 않는다.

다른 원본 추출의 ID, 삭제한 자료, 템플릿 job은 404다. 빈 선택·중복 ID·50개 초과·잘못된 종류는 422다. 같은 원본/프로필의 불변 추출은 재사용하되 응답의 reference/job/file version은 요청 대상에 고정한다. 원본 교체 후에도 이전 job을 명시하면 이전 버전을 읽을 수 있고, 선택한 자료가 조용히 최신 파일로 바뀌지 않는다. 파생 파일 다운로드는 해당 job에 연결된 Blob만 허용한다.

V11은 `document_native_packages`와 `document_materials`를 추가한다. 원문을 복사하지 않고 content_blocks와 page/extraction 복합 외래 키로 연결한다. Document Extraction schema 2가 재사용 인덱스를 가지며 schema 1은 그대로 판독한다. 구버전 원본을 재추출하려면 명시적인 준비 요청이 필요하다.

## 공통 PPT 패키지와 저장 수명

`ppt_imports(source_sha256, profile, package_sha256, created_at)`는 원본·분석 프로필당 공통 PPT Master 결과 한 건을 소유한다. 템플릿 실행은 `template_import_links`로, 레퍼런스 추출은 `document_native_packages`로 같은 패키지를 연결한다. 역할별 등록·파일 버전·작업 이력은 합치지 않는다. 공통 프로세스 실행은 단일 admission gate로 직렬화하고 대기 중 취소를 지원한다. 완료된 공통 추출은 재시작 후에도 재사용한다.

패키지는 ZIP이 아니라 `schema_version: 1`과 정렬된 `files[{path, sha256, size}]`를 가진 JSON Blob이다. 구성 파일의 바이트는 공통 Blob Store에 저장하고 `asset_package_members(package_sha256, path, blob_sha256)`에서 참조한다. 이미지·구조 JSON·SVG·장표 미리보기도 바이트가 같으면 한 파일을 공유한다. 빈 구성 파일은 빈 바이트의 표준 해시와 크기 0으로 표현하며 물리 파일이나 크기 0의 file_blobs 행은 생성하지 않는다. PPTX 원본은 패키지에 다시 넣지 않는다. 원본 PPTX 내부의 압축된 미디어와 독립적으로 사용하는 추출 미디어, SVG에 포함된 이미지 표현, 미리보기는 목적이 다른 표현이며 의미 기반 중복 제거 대상은 아니다.

신규 템플릿의 manifest/native structure 정본은 패키지 구성 Blob에만 있다. DB에 JSON 본문을 복사하지 않는다. API는 저장된 구성 파일을 읽어 기존 Analysis 응답을 조립한다. 파일 경로는 상대 경로만 허용하고 정렬·중복·크기·개수·해시를 검증한다. 구성 파일의 총크기는 최대 160 MiB, 개수는 10,000개다.

`template_bundle`과 자료 목록의 `bundle`은 패키지의 불변 식별자다. 기존 결과에서는 ZIP Blob 해시, 신규 결과에서는 manifest Blob 해시이며, **신규 다운로드 ZIP 바이트 자체의 해시는 아니다.** 기존 `/document-jobs/{id}/files/{hash}`는 소유 관계를 먼저 확인한 뒤 신규 패키지만 ZIP으로 조립한다. 파일 순서·ZIP 날짜·권한·압축 방식을 고정하고 모든 구성 파일의 해시를 검사한다. ZIP은 staging의 임시 파일이며 응답 종료·취소 시 해제된다. ZIP 준비/다운로드는 업로드와 독립된 한 슬롯으로 제한하며 포화 시 503을 반환한다. 다운로드 ZIP을 영구 Blob으로 다시 저장하지 않는다.

V12는 새 테이블만 추가한다. 기존 `template_extractions`의 JSON·ZIP, 기존 문서 추출과 파일 버전은 그대로 판독한다. 구버전 결과를 자동 이관하거나 재생성하지 않는다. 명시적으로 새 추출을 요청한 결과부터 새 저장 방식을 사용한다.

### 미참조 Blob 수거

서버 시작 시 저장소 독점 잠금을 확보하고 Migration을 마친 뒤, HTTP와 Worker를 시작하기 전에 실행한다. `file_blobs`를 참조하는 모든 SQLite FK를 검사하므로 원본·과거 버전·공통 추출 캐시·패키지 구성·자료 미리보기는 보존한다. `backups/`의 일관된 SQLite 스냅샷에 기록된 Blob도 모두 보호한다. 백업은 immutable read-only로 열어 sidecar를 생성하지 않는다. 깨진 백업·WAL·알 수 없는 백업 형식·비정상 Blob 경로를 발견하면 수거를 생략하고 로그를 남긴다.

미참조 파일은 `blob_collection_candidates`에 최초 관찰 시각을 기록한다. 첫 관찰에서는 삭제하지 않고, 7일 이후 시작에서 다시 참조와 백업을 확인한 대상만 최대 1,000개 수거한다. 중간에 참조가 생기면 후보 표시를 해제한다. 삭제 직전 파일 해시와 크기를 검사하고 디렉터리를 동기화한다. 파일 삭제 후 DB 행을 제거하며 그 사이 중단된 경우 다음 시작에서 남은 후보를 이어서 정리한다. 실행 중 수거, 등록된 확정 버전의 폐기, 외부 저장소의 임의 백업 탐색은 제공하지 않는다. 외부 백업은 필요한 Blob을 자체 스냅샷에 포함해야 한다.

## Studio 원본·가이드 API

| 경로                                                           | 동작                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| GET/POST `/api/v1/projects/{project}/files`                    | 프로젝트별 검색/페이지 목록, 원본 multipart 등록          |
| GET/DELETE `/api/v1/projects/{project}/files/{id}`             | 원본 등록 조회, expected_version 조건부 논리 제거         |
| GET/POST `/api/v1/projects/{project}/files/{id}/versions`      | 파일 버전 조회, X-Expected-Version 조건부 교체            |
| GET `/api/v1/projects/{project}/files/{id}/download?version=n` | 정확한 파일 버전의 원본 다운로드                          |
| GET/POST `/api/v1/projects/{project}/files/{id}/processing`    | 현재/지정 job 결과와 명시적 재처리                        |
| GET `/api/v1/projects/{project}/files/{id}/processing/history` | 원본의 버전별 처리 이력                                   |
| GET/PUT `/api/v1/projects/{id}/source-review`                  | 현재 snapshot/ready/confirmed/count, snapshot 조건부 확인 |
| GET/PUT `/api/v1/projects/{id}/guide`                          | 최신 Do/Don’t, expected_version 조건부 새 리비전          |

업로드·교체는 기존 Idempotency-Key receipt, 취소 API와 파일 검사/제한을 재사용한다. receipt는 프로젝트 범위를 고정하며 같은 키를 다른 프로젝트에 재사용하면 409다. 다른 프로젝트의 파일 ID는 404다. 프로젝트 원본은 Space public 목록에 나타나지 않는다. 내부 처리 kind `project-{uuid}`는 scope 전달값이며 `/space/project-{uuid}` 경로도 같은 범위 검사를 적용하는 호환 바인딩이다. 사용자의 접근 권한이나 계정 식별자가 아니다.

V13은 `source_items`, `source_versions`, `project_source_reviews`, `project_source_review_files`, `project_guide_revisions`를 추가한다. document_jobs와 upload_requests는 source FK를 지원하도록 기존 ID/행을 유지해 재구성한다. SQLite 표준 rebuild 절차에 따라 Migration 연결만 FK actions를 일시 해제하고, SQL 트랜잭션 내부 `pragma_foreign_key_check` guard를 통과해야 commit한다. 서비스 연결은 항상 foreign_keys=ON이다. 업그레이드 전 백업을 만들며 확정 결과와 기존 receipt는 유지한다.

원본 확인은 정렬된 현재 파일 버전/추출 ID 집합의 SHA-256 snapshot으로 CAS를 수행하고 review와 연결 행을 함께 저장한다. 같은 snapshot 재확인은 멱등이다. 파일이 없거나 준비되지 않았으면 422, 확인한 집합과 달라졌거나 보관 상태면 409다. 새 원본 등록은 독립 작업을 만들고 동일 원본/분석 프로필의 추출 결과를 재사용한다.

가이드는 초기 version 0과 빈 두 필드를 반환한다. PUT은 expected_version/do_text/dont_text만 받으며 각 2,000자 이하, 충돌 409, 없는 프로젝트 404다. 저장 시 schema_version=1과 parent revision을 가진 새 행을 만들고 기존 행은 수정하지 않는다. 현재 UI는 최신 버전 편집을 제공하며 과거 가이드 복원 UI는 후속 범위다.

## 관계 검색 저장·API 계약

V14의 `relation_runs`는 프로젝트, UUID 요청 키, 입력 fingerprint, 검색어/조건, 원본 snapshot hash, guide revision, Provider config revision, definition_version=1, 상태·lease·attempt·version을 저장한다. `relation_sources`는 시작 시 원본 파일 버전/추출 ID를, `relation_candidates`는 file/block 후보와 발췌 블록을, `relation_origins`는 모든 실제 등록 버전/job 관계를 저장한다. 원문·이미지·검색 인덱스를 프로젝트마다 복제하지 않는다.

`relation_assessments`는 입력 문맥·후보의 추출/블록/본문 범위·모델 설정·판정 정의로 계산한 키, 관계, 실제 반환 통계와 성공한 llm_request ID를 저장한다. 관계 값은 0 비관련, 1 같은 업무 맥락, 2 뒷받침 자료, 3 재사용할 접근 방식, 4 차이/상충 확인, 5 정보 부족이다. 정상 판정만 불변으로 등록하고 실패·누락·잘못된 출력은 캐시에 저장하지 않는다. 같은 검색의 완료 checkpoint 재개는 completed에, 다른 검색의 저장 판정 연결은 cache_hits에 반영한다. 이 테이블은 출처를 가진 판정 정본이며 임의 TTL로 참조 중인 기록을 삭제하지 않는다.

`relation_links`는 프로젝트가 선택한 출처 버전과 후보를 고정한다. 내용 선택은 content_block_id를 간접 참조하고 전체 파일 선택은 extraction을 참조한다. active/version만 조건부로 갱신하며 `relation_link_changes`가 선택/해제 당시 후보와 버전을 보존한다. 같은 파일이라도 출처의 등록 버전이 다르면 별도의 선택 이력이며 물리 바이트는 공유한다. 기존 원본/분석/모델 데이터는 수정하지 않는다.

| 경로                                                                                     | 동작                                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| GET/POST `/api/v1/projects/{project}/related-searches`                                   | 최근 실행 조회, UUID Idempotency-Key로 명시적 검색 생성                         |
| GET `/api/v1/projects/{project}/related-searches/{id}`                                   | 고정 실행의 상태·실제 처리 수·stale 여부                                        |
| GET `/api/v1/projects/{project}/related-searches/{id}/results?kind=file\|block&offset=n` | 12개 단위 결과, 출처 최대 20개 미리 제공                                        |
| POST `/api/v1/projects/{project}/related-searches/{id}/retry\|cancel`                    | expected_version·UUID 요청 키 조건부 명령                                       |
| GET `/api/v1/projects/{project}/related-candidates/{id}/origins?offset=n`                | 20개 단위 전체 출처 등록·프로젝트 관계                                          |
| GET/PUT `/api/v1/projects/{project}/related-items`                                       | 현재 선택, candidate_id/source_version_id/expected_version/selected로 추가·해제 |
| GET/PUT `/api/v1/admin/related-search/settings`                                          | 별도 작업별 연결 선택; expected_version CAS                                     |

POST 입력은 query(최대 120자), options(include_archived, previous_versions, source_project, format, since)다. API 기본은 보관/이전 버전 제외이며 UI는 보관 포함을 명시적으로 보낸다. since는 등록 시각 기준 epoch milliseconds다. 결과에는 원본 버전, 정확한 job/page ID, 발췌와 미리보기, origin_count(등록 수), project_count(서로 다른 프로젝트 수), 선택의 기준 버전을 포함한다. 모델의 판단으로 프로젝트 소속을 만들지 않는다.

다른 프로젝트 실행/후보 접근은 404, 오래된 선택/원본 snapshot·명령·설정은 409, 잘못된 입력/원본 미준비는 422, 영속 대기 검색 20개 포화는 503이다. 선택은 프로젝트당 100개, 입력 원본 snapshot은 256개까지 지원한다. 현재 문맥은 최대 16개 추출의 일부 블록과 제한된 가이드 발췌를 사용한다. source/guide 변경은 기존 실행의 입력을 덮어쓰지 않는다. 삭제된 출처는 새 검색·원본 열기에서 제외하지만 이미 선택된 ID와 참조는 보존한다.

모델 호출은 기존 외부 요청 제한을 따르고 실패/취소 후 완료된 후보부터 다시 계산하지 않는다. 실행 중 상태와 30초 lease를 저장하고 2초 heartbeat로 연장하며 재시작 시 미완료 실행을 복구한다. 성공 checkpoint 저장에도 현재 lease를 검사하여 늦은 응답을 차단한다. HTTP 대기 중 응답이 유실된 모델 호출은 결과가 확정되지 않았으므로 재시도될 수 있다. 이는 외부 호출 exactly-once 보장이 아니다.

## vLLM-SR 연결 저장

`provider_type=vllm_sr_decision`은 기존 Provider 생성/수정·조회·모델 발견·판정 API를 사용한다. 서버 카탈로그가 Admin Decision 옵션을 제공하므로 프론트엔드에 별도 Provider 목록을 복제하지 않는다. 저장된 연결은 문서 처리 및 자료 찾기의 모델 선택에도 나타난다.

V15는 `llm_provider_config_versions`의 Provider CHECK 제약만 확장한다. 기존 ID, 설정 리비전, 암호화 키 본문과 요청·문서·검색 참조를 유지하며 새 테이블 복사/전환 후 트랜잭션 안에서 외래 키를 검사한다. V1~V14 Migration은 변경하지 않는다. 실제 외부 endpoint와 API Key는 자동 등록하지 않는다.

## Markdown 원본·추출 계약

Space 레퍼런스와 Studio 원본에서 `.md`/`.markdown`(대소문자 무관)을 허용한다. 템플릿은 PPTX만 받는다. UTF-8/BOM과 일반 텍스트도 허용하며, 빈 내용·비텍스트 제어 바이트·다른 바이너리·잘못된 인코딩은 422로 거부한다. Markdown은 최대 2 MiB, 50,000줄, 줄당 65,536bytes다. 브라우저 안내/파일 크기 검사는 UX용이며 서버가 같은 제한을 강제한다.

원본은 바이트 그대로 Blob에 저장한다. V16 `registered_file_facts` 조회 view는 변경 불가능한 원래 파일명의 확장자로 HTML/Markdown 해석과 MIME을 결정한다. 동일 바이트의 서로 다른 등록은 한 Blob을 공유하지만 추출 profile은 달라 결과가 섞이지 않는다. 기존 바이너리 등록의 형식은 유지하며 원본·리비전·설정 데이터를 재작성하지 않는다.

Markdown은 `markdown-comrak-0.59.0-gfm-passive-v1` profile로 고정한다. Kordoc 기반 기존 profile은 유지하며 두 profile을 작업 생성 시에만 선택한다. 라이브러리/어댑터 의미 변경 시 새 profile을 사용하고, 진행 중 작업이나 기존 확정 추출을 임의로 다시 생성하지 않는다.

Comrak의 CommonMark/GFM AST에서 제목, 문단, 목록/체크리스트, 인용, 코드, 표, 참조를 읽는다. 블록은 원문의 1-based 줄·문자 열 범위, 제목 수준, 목록/인용 정보, 코드 언어를 보관한다. 표는 행별 정본 텍스트와 셀의 UTF-8 byte 범위·정렬 정보로 저장하며 셀 본문을 metadata에 다시 복사하지 않는다. 긴 텍스트는 UTF-8 경계를 보존해 6,000byte 단위로 분할하며 `text_offset`은 원래 블록 텍스트 기준 byte 위치다. 이미지/링크는 주소·제목과 대체 텍스트를 보존하지만 네트워크·로컬 파일을 읽지 않는다.

HTML 블록은 코드 텍스트로, inline HTML은 문자로 표시한다. React의 text 경로만 사용하고 HTML renderer/iframe/실행 기능은 제공하지 않는다. 다운로드는 `text/markdown`, attachment, nosniff와 sandbox CSP를 반환한다. 현재 미리보기는 추출된 텍스트이며 Markdown 조판·수식 실행·외부 이미지 렌더링은 범위 밖이다.

AST 검사 중 취소와 깊이 128·노드 200,000·블록 20,000·출력 용량을 제한한다. Comrak 초기 동기 파싱은 bounded blocking 작업에서 실행되며 이미 시작한 파서를 강제 중단한다고 보장하지 않는다. 크기 제한 안에서도 병적인 입력의 CPU/메모리 운영 수용 검사는 별도다. 저장·작업 상태·내용 검색·교체·재시도·출처 연결은 기존 문서 파이프라인을 재사용한다.

## Space 통합 검색 API

`GET /api/v1/search?q=&scope=all|references|templates&mode=all|files|content&archived=false&offset=0`은 한 페이지 12개 결과와 total을 반환한다. 검색어는 120자 이내이며 빈 검색은 빈 결과다. `files`는 제목·원래 파일명·태그, `content`는 추출 본문을 대상으로 한다. `all`은 두 일치 집합을 합치고 같은 등록은 한 행으로 표시한다. 프로젝트 원본은 제외하며 `scope=projects` 요청은 거부한다.

최신 파일 버전의 등록만 검색하고 삭제 자료를 제외한다. 보관 자료는 명시적으로 포함한다. 결과에는 kind/id/title/filename/format/file_version/updated_at, job_id/page_id/page_label, preview Hash, 발췌문과 이름·본문 일치 여부가 들어간다. 모델 점수나 가짜 관련성 백분율은 제공하지 않는다. 링크는 반환된 작업·페이지를 고정해 결과 조회 중 원본이 교체되어도 다른 버전으로 조용히 전환하지 않는다.

본문은 기존 `content_blocks_fts`의 bounded query terms와 snippet을 사용하며 파일 정보 일치를 우선하고 본문 순위·날짜·ID로 안정 정렬한다. SQL 파라미터로 검색어를 전달하고 서버가 모든 scope/mode/offset을 검증한다. 현재 템플릿은 이름·태그 검색과 장표 미리보기를 제공하며 템플릿 본문 색인은 포함하지 않는다. 새 DB Migration이나 저장된 업무 데이터의 재작성은 없다.

## 목차·콘텐츠 리비전과 작업

V17은 outline_heads, outline_revisions, outline_nodes, outline_node_versions, outline_revision_nodes, outline_assignments, outline_confirmations와 outline_runs/run_blocks/run_batches/run_commands를 추가한다. 기존 데이터는 재작성하지 않는다. head의 version 조건으로 공유 편집 충돌을 검사하고, 변경 없는 노드 버전을 재사용한다. 연결은 content_block_id와 source_version_id를 참조하며 원문 텍스트를 복사하지 않는다. 확정은 특정 리비전의 불변 기록이다.

| API                                                                  | 동작                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GET/PUT `/api/v1/projects/{id}/outline`                              | 현재 목차 조회 / expected_version·source_snapshot·guide_version 조건으로 새 리비전 저장 |
| POST `/api/v1/projects/{id}/outline/confirm`                         | 현재 리비전 확정; 현재 입력과 일치하고 모든 마지막 목차에 근거가 있어야 함              |
| GET `/api/v1/projects/{id}/outline/revisions`                        | 최근 100개 리비전 메타데이터                                                            |
| GET `/api/v1/projects/{id}/outline/revisions/{revision}`             | 해당 프로젝트의 과거 리비전 조회                                                        |
| GET `/api/v1/projects/{id}/outline/blocks`                           | 원문 후보 조회; q·offset·선택적 revision 또는 최대 20개 ids, 페이지당 20개              |
| POST `/api/v1/projects/{id}/outline/runs`                            | 명시적 generate/map 요청; Idempotency-Key와 입력/목차/모델 version 조건                 |
| POST `/api/v1/projects/{id}/outline/runs/{run}/cancel` 또는 `/retry` | expected_version·Idempotency-Key를 검증하는 명시적 명령                                 |

목차는 1~24개, 두 단계, 제목 120자·수동 설명 1,000자, 연결 최대 4,000개다. 부모/자식의 순서·순환·중복 ID 및 다른 프로젝트/확인하지 않은 원문 연결을 거부한다. 수정·생성·연결은 새 리비전이며 과거 리비전과 원본을 삭제하지 않는다.

작업은 definition_version=1, source_review_id, guide_revision_id, provider config_id, base_version을 고정한다. 하나의 감독 작업자가 처리하며 30초 lease와 2초 heartbeat, 종료 취소·재시작 복구·늦은 결과 거부를 적용한다. 성공 배치 응답과 llm_request_id를 체크포인트로 보존한다. 모든 배치가 검증되기 전에는 현재 목차를 바꾸지 않는다. 진행 중 수정·가이드·원본 변경은 최종 CAS/입력 검사에서 충돌로 처리한다. 취소된 작업의 늦은 응답은 적용하지 않는다.

구조화 응답은 기본 object/array/string/enum 계약을 전송하고 계층·길이·중복·허용된 ID와 완전성은 서버가 검증한다. Provider별 JSON Schema 부분집합 차이를 고려하며 [OpenAI 지원 범위](https://developers.openai.com/api/docs/guides/structured-outputs)를 참고한다. 생성 문맥은 원문 전체에서 최대 48개·각 240byte 발췌, 매핑은 8개·각 600byte 발췌와 짧은 목차 설명을 사용하며 전체 system+prompt는 32 KiB로 제한한다. 바이트 상한을 모델별 토큰 보장으로 해석하지 않는다. 초과·실패는 오류로 표시하고 외부 엔진의 context/batch 설정을 바꾸지 않는다.

### 이미지·표 추출 정보 보존

`document-structure.mjs`는 Kordoc의 `parsed.images`를 블록 파일명과 연결하고 병합·중첩 표 구조와 셀 텍스트 범위를 보존한다. 원본 텍스트는 한 번 저장하며 표 셀은 UTF-16 code-unit 범위로 참조한다. 분할 블록의 text_offset을 보존한다. 이 helper를 런타임 manifest에 포함하므로 새로운 추출 profile이 적용된다. 과거 추출은 유지하며 자동 재추출하지 않는다.

완전한 단일 블록의 작은 표는 shadcn Table로 병합 구조를 표시한다. 과거 메타데이터 없는 결과, 분할 표, 100행/30열을 넘는 표는 원문 텍스트 표시를 유지한다. 복잡한 원본 조판이나 중첩표 전체 화면 재현을 보장하지 않는다.

## V18 검색 작업 공간

V18은 기존 분석을 덮어쓰지 않고 다음 상태를 추가한다.

| 저장 위치                           | 책임                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| relation_workspaces                 | 정의 버전 2, 단계/회차, 보완 LLM 설정 버전, 종료 시각과 사유 |
| relation_reads                      | 후보/회차/순서별 정본 블록 ID와 읽은 UTF-8 접두 바이트 수    |
| relation_workspace_peers            | 재검토 전에 고정한 최대 4개 비교 자료의 후보·블록 참조       |
| relation_review_history             | 재검토 전의 불변 판정 키                                     |
| relation_pulls                      | 추가 검색어, 계획 요청 ID, 새 후보 수의 원자적 체크포인트    |
| relation_candidates.workspace_round | 후보 문맥 버전; 원문 조회 캐시 갱신 기준                     |

초기 후보는 기존 최대 48개다. 비교 후 최대 12개 모호한 후보에서 앞뒤 3블록씩, 대상 포함 최대 7블록을 읽는다. 대상은 기존 읽기 범위를 줄이지 않도록 최소 800바이트에서 최대 1,800바이트까지 보존하고, 주변은 각 400바이트다. 초기 읽기는 후보당 최대 1,800바이트다. 원문 복사본은 저장하지 않는다.

추가 검색은 최대 3개 질의(각 120자), 질의당 미등록 본문 8개이며 전체 후보는 파일/본문 합계 96개 이하다. 2회차 비교 후 자동 확장을 종료한다. 최초 실행부터 5분 제한은 취소·재시작 사이에도 유지한다. 한도 종료는 부분 결과이며 새 조사에는 명시적인 새 검색이 필요하다.

네이티브 Decision은 후보별, 구조화 LLM은 최대 8개/28 KiB로 묶고 최대 4개 요청을 연결별 admission 한도 안에서 병렬 실행한다. 보완 LLM은 최대 20 KiB 입력과 512 출력 토큰, JSON 검색어만 받는다. 바이트 상한은 모델별 토큰 문맥 보장이 아니다.

검색어와 새 후보/출처/읽기 등록은 한 트랜잭션이며 중복 후보는 조회 제한 전에 제외한다. 추가 후보는 검색 시작 이후 등록된 버전을 제외하고 수집 시 추출/job을 고정한다. 전체 코퍼스 스냅샷을 복제하지 않는다. 이미 고정한 원본은 리비전 보존 정책을 따른다.

실패·취소 재시도는 완료 판정과 단계 체크포인트를 재사용한다. 모델 호출과 DB 저장 사이에서 종료된 읽기 전용 요청은 재호출될 수 있다. exactly-once 모델 호출은 보장하지 않는다. 기존 실행은 원래 단일 평가 방식으로 재개하며 자동 재분석하지 않는다.

GET 실행 응답의 exploration은 phase, round, read_blocks(고유 블록 수), added_candidates, unresolved(미평가·정보 부족·조건 차이), stop_reason을 제공한다. 기존 실행은 null이다. 종료 사유는 reviewed, needs_review, no_new_results, budget이며 전체 코퍼스에 근거가 없다는 증명이 아니다. 한도 종료는 succeeded 상태여도 모든 후보의 검토 완료를 뜻하지 않는다.

GET `/api/v1/projects/{project}/related-candidates/{id}/evidence`는 최대 7개 읽기와 4개 비교 자료의 block_id, page_id, page_label, 발췌, truncated, origin, comparison을 제공한다. 다른 프로젝트의 후보는 404이고 삭제된 출처는 공개하지 않는다. Admin 설정의 planner_connection_id는 선택적 생성 LLM이며 Decision 연결은 사용할 수 없다. 설정 저장은 새 실행에만 적용한다.

판정 기준 0~5의 definition_version=1은 유지하고, 문맥 구성은 relation_assessments.context_version=2로 구분한다. 기존 판정은 context_version=1을 유지한다. 실행 흐름은 relation_workspaces.definition_version=2이며 문맥 해시와 버전이 다른 판정은 재사용하지 않는다.

## V19 발표자료 준비·생성

`presentation_evidence_reviews/links`는 확정한 Outline Revision과 선택 당시 relation_link_changes 버전을 고정한다. 원문은 복제하지 않는다. `presentation_designs`는 근거 확인과 optional template_job_id를 참조하고 `presentation_preparations`가 CAS head를 관리한다. 선택한 템플릿이 교체되어도 이미 고정한 파일 버전을 사용한다.

`presentations`는 프로젝트별 발표자료 식별자와 현재 결과 head를 보관한다. `presentation_runs`는 멱등 요청 키, 고정 디자인·Provider config·도구 프로필·정의 버전, lease/heartbeat, 상태/단계, 기본 revision version을 갖는다. `presentation_slide_versions`는 각 목차의 Spec Blob·PNG Blob·모델 요청 ID를 참조하고 `presentation_slide_evidence`가 canonical 블록을 연결한다. `presentation_revisions/revision_slides`는 검증을 통과한 출력 Blob과 장표 목록을 불변으로 저장한다.

| 메서드·경로                                           | 동작                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/projects/{p}/presentation-preparation`   | 최신 입력 fingerprint·근거 확인·디자인·예상 장수                                                           |
| `POST .../presentation-preparation/evidence`          | `{fingerprint}` 일치 시 명시적 근거 확정                                                                   |
| `PUT .../presentation-preparation/design`             | expected_version, evidence_review_id, template_job_id(null=기본)                                           |
| `GET /api/v1/projects/{p}/presentations`              | 최근 생성 작업 50개; id는 생성 작업/결과 revision ID                                                       |
| `POST /api/v1/projects/{p}/presentations`             | design_id, title, instructions, connection_id, model_version, presentation_id(null=신규), expected_version |
| `POST .../presentations/{run}/{retry,cancel}`         | expected_version와 Idempotency-Key로 명시적 제어                                                           |
| `GET .../presentations/{run}/slides`                  | 완료한 Spec·미리보기 준비 상태                                                                             |
| `GET .../presentations/{run}/slides/{slide}/evidence` | 고정 원본 버전·페이지와 canonical 발췌                                                                     |
| `GET .../presentations/{run}/slides/{slide}/preview`  | 성공한 결과의 PNG                                                                                          |
| `GET .../presentations/{run}/download`                | 성공한 결과의 편집 가능한 PPTX                                                                             |

생성/재시도/취소는 Idempotency-Key를 요구한다. 같은 키의 다른 입력과 stale version은 409, 준비되지 않은 입력은 422, 프로젝트/결과 범위 불일치는 404다. 시작과 최종 commit에서 입력/디자인을 재검사하며 만료된 lease와 오래된 결과는 head를 전진시키지 못한다. 중단 후 완료한 Spec은 재사용한다. Blob 게시 후 DB commit 전 중단된 파일은 기존 고아 Blob 유예/참조 검사 대상이다. 외부 모델 요청 직후 checkpoint 전 종료된 경우 읽기 전용 추론은 재실행될 수 있다.

## Admin 접근 토큰

각 서버 인스턴스는 OS 난수 생성기로 32바이트(64자리 hex) 토큰을 만든다. CLI가 시작 성공 시 한 번 표시하며 DB·설정 파일에는 저장하지 않는다. `/api/v1/admin`과 그 하위의 모든 경로는 `Authorization: Bearer <token>`을 요구한다. `POST /api/v1/admin/access`는 같은 검사를 거쳐 `{authenticated:true}`만 응답하며 토큰을 반환하지 않는다. 누락/오류는 401, 30초 구간에 잘못된 토큰 30회 초과는 429/Retry-After다. 올바른 토큰은 잘못된 시도로 잠기지 않는다. 서버 재시작은 이전 토큰을 무효화한다.

일반 사용자의 `GET /api/v1/models/authoring`은 활성화된 LLM의 id/name/model_identifier/version만 제공한다. 연결 주소·인증 여부·키·진단 이력은 제공하지 않는다. Studio 목차·PPT 생성은 이 조회를 사용하고 설정 쓰기·네이티브 모델 조회/테스트는 보호된 Admin API를 계속 사용한다. 프로젝트·Space API의 공유 범위는 바뀌지 않는다.

브라우저는 확인된 토큰을 현재 Admin 방문의 메모리에만 보관하고 보호된 경로에만 헤더를 붙인다. 잠금·다른 메뉴 이동·새로고침·페이지 이탈·401에서 다시 입력해야 한다. 계정이나 사용자별 세션을 만드는 기능이 아니며 현재 토큰은 일반 설정에서 변경하거나 서버를 종료하기 전까지 유효하다. 이전에 승인된 작업은 화면을 잠가도 완료될 수 있다.

`GET /api/v1/admin/general`는 현재 프로세스의 설정 version만 반환한다. `PUT /api/v1/admin/general`은 `{expected_version,token}`을 받고, 공백 없는 ASCII 영문·숫자·기호 12~128자를 새 토큰으로 적용한다. version 불일치는 409, 형식 오류는 422다. 변경 즉시 이전 토큰은 무효화되고 성공한 브라우저도 Admin을 잠근다. DB/파일에 저장하지 않으며 재시작하면 version 1과 새 256비트 CLI 토큰으로 초기화한다. 일반 설정의 토큰 변경은 다른 서비스나 Worker의 수명·인증에 관여하지 않는다.

## V20 슬라이드 대화 수정

`presentation_run_slides`는 run과 slide version의 순서 관계를 보관하며 V19 장표를 그대로 연결한다. `presentation_edits`는 고정 base revision/version, source slide, 모델 config, runtime profile, 선택 필드, 요청문, lease, 제안 Spec Blob 및 적용 run을 소유한다. `presentation_edit_commands`는 버전 조건과 멱등 명령을 기록한다. 원문 본문을 복사하지 않으며 미변경 slide version을 새 deck에 연결한다.

- `GET/POST /api/v1/projects/{p}/presentations/{run}/slides/{slide}/edits`: 해당 논리 장표의 최근 20개 요청 조회/접수. POST는 expected_version, connection_id, model_version, prompt(최대 2,000자), fields(title/bullets/notes)를 받는다.
- `POST /api/v1/projects/{p}/slide-edits/{edit}/{apply,reject,retry,cancel}`: expected_version과 Idempotency-Key를 받는다. 접수 역시 Idempotency-Key 필수다.
- 상태는 queued/running/ready/applying/applied/failed/cancelled/rejected다. 완료된 제안만 적용하고 현재 deck과 맞지 않는 요청은 409, 다른 프로젝트는 404다. API가 반환하는 before/proposal은 Spec Blob에서 읽는다.
- 제안 생성은 최대 24 KiB 입력·4,096 출력 토큰의 한 번의 구조화 요청이다. token context 보장은 모델별 별도 조건이다. 현재 근거 발췌와 최근 적용 대화 3개를 참고하며 선택 범위 밖 출력은 거부한다.
- 적용은 변경 장표 버전과 새 rendering run을 원자적으로 접수한다. 전체 출력 검증 후에만 head를 갱신한다. 취소/실패한 출력을 최신 결과로 노출하지 않으며 기존 run retry/cancel을 사용한다. 서버 재시작은 lease 작업을 복구한다. 응답의 is_current로 과거 리비전 편집을 막되 서버도 동일 조건을 강제한다.
