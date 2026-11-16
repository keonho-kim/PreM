# 품질·보안·운영 준비도

## 실제 대화 수정 검증

`backend/tests/slide_edits.rs`는 범위 밖 응답 거부, 제안/적용 분리, 취소·재시도·stale 충돌, 멱등 명령, 다른 장표 version 재사용, 이전 결과 보존·재시작을 확인한다. `slide_edit_migration.rs`는 V19 데이터/출력을 보존한 V20 연결 이관을 검사한다. React 테스트는 IME/Shift+Enter, 전후 비교의 명시적 적용, draft 분리, 미완성 출력의 이미지 요청 차단을 다룬다.

`tests/e2e/slide-chat.cjs`는 격리된 실제 서버에서 합성 초안 생성 → 대화 수정 제안 → 검토 → 적용 → 새 PPTX 다운로드를 확인한다. 기본은 합성 모델이고 `PUPUTYX_EDIT_MODEL=ornith`를 명시할 때만 로컬 LM Studio의 Ornith를 호출한다. 실제 업무 자료는 사용하지 않는다.

Ornith 1.5 35B A3B Q4_K_M을 LM Studio Native `/api/v1/chat`로 호출해 제목만 **현황 요약 → 검증 완료**로 수정했다. 모델 요청 1회, 본문·발표 메모·근거·다른 장표 및 이전 리비전 보존, 명시적 적용 후 리비전 2와 편집 가능한 DrawingML 텍스트를 확인했다. 보고서는 `tests/.artifacts/ornith-slide-edit-report.json`, 산출물은 `tests/.artifacts/ornith-edited.pptx`다. 이는 간단한 텍스트 수정 검증이며 다양한 업무 지시·다른 모델·이미지/차트 편집 품질을 보장하지 않는다.

## 검증 경계

현재 검증은 실제 공유 프로젝트·Space 기능의 저장·API·React 연결과 별도 브라우저 목업을 대상으로 한다. 실제 문서 분석·PPTX 생성, 기업 규모의 부하·운영 복구·보안 적합성을 입증하지 않는다. 이 문서는 재현 가능한 검사와 남은 수용 조건을 정의하며 특정 실행의 통과 이력을 누적하지 않는다.

## 제품 검사 명령

| 명령                                 | 실제 검사                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `pnpm tokens:check`                  | 토큰 원본과 두 UI의 생성 CSS 일치                                              |
| `pnpm format:check`                  | Biome 코드 포맷·Prettier 마크업·rustfmt                                        |
| `pnpm check`                         | 토큰·포맷, Biome, Knip, React 빌드, Clippy, nextest·doctest·Vitest·의존성 정책 |
| `pnpm test`                          | Rust 전체 feature의 nextest·doctest와 Vitest                                   |
| `pnpm build`                         | 토큰 검사, React 빌드, UI를 포함한 Rust 릴리스 빌드                            |
| `pnpm smoke`                         | 릴리스 빌드 후 실제 서버 시작·재시작·HTTP·파일 보존 검사                       |
| `./scripts/smoke-test.sh --no-build` | 준비된 릴리스 실행 파일의 smoke 검사                                           |

[backend/tests/http.rs](../backend/tests/http.rs)는 Health 식별 정보와 없는 API의 JSON 404를 검사한다. [smoke_test.py](../scripts/smoke_test.py)는 정적 자산, 상대 경로 거부, 중복 저장소 잠금, 재시작 후 표식 파일 보존을 검사한다. 제품 테스트 출력은 `tests/.artifacts/`에 격리한다.

[home-page.test.tsx](../frontend/src/pages/home-page.test.tsx)는 Health 응답 검증·실패 후 재시도·화면 종료 시 요청 취소를 검사한다. Vitest는 jsdom을 사용하며 테스트 없는 성공 설정은 제거했다. 실제 브라우저의 레이아웃·접근성 검증은 별도로 수행한다.

[dependency_contracts.rs](../backend/tests/dependency_contracts.rs)는 bundled SQLite와 refinery의 Migration 재실행·FTS5·FK·백업 호환성, 로컬 schema 검증·외부 참조 거부, 분할 UTF-8 SSE·취소 후 task 종료를 검사한다. 이는 제품 DB·업무 Workflow 구현이 아니라 기반 패키지의 조합 검증이다.

## 의존성 검사와 도구 설치

```sh
pnpm tools:install
pnpm tools:check
pnpm check:deps
```

`pnpm check`는 도구 버전을 확인하고 `cargo-machete`, `cargo-deny`, `pnpm audit`를 포함한다. Rust 일반 테스트는 nextest, doctest는 Cargo가 실행한다. `pnpm test:rust`는 전체 feature에서 포함 UI가 필요하므로 React를 먼저 빌드한다. `check:deps`는 advisory·registry 조회를 위해 네트워크가 필요할 수 있다. 실패를 자동 무시하거나 취약점 예외를 추가하지 않는다.

`cargo-machete`는 패키지의 미사용 직접 의존성을 검사한다. workspace의 향후 버전 선언과 실제 패키지 연결은 구분한다. Rust의 `dead_code`·unused 경고는 Clippy의 `-D warnings`와 함께 처리한다. 공개 API, 동적 사용, 생성 코드까지 완전하게 판정하는 것은 아니다. [도구·정책 원본](08-dependencies.md)

## 커버리지

```sh
pnpm coverage
# 개별 실행
pnpm coverage:frontend
pnpm coverage:rust
```

| 대상  | 실행·계측                              | 산출물                                                                                |
| ----- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| React | Vitest V8, `src/**/*.ts(x)`            | `tests/.artifacts/coverage/frontend/index.html`, `lcov.info`, `coverage-summary.json` |
| Rust  | 고정 rustup toolchain의 cargo-llvm-cov | `tests/.artifacts/coverage/rust/html/index.html`, `lcov.info`                         |

Rust 커버리지 명령은 포함 UI가 필요한 전체 feature 빌드를 위해 React를 먼저 빌드한다. LLVM 도구는 compiler와 같은 rustup toolchain을 사용하며 계측 빌드는 `tests/.artifacts/coverage/rust-build/`에 둔다. 보고서 생성만 다시 수행할 때 테스트를 재실행하지 않는다.

테스트 코드·타입 선언을 제외하고 실제 앱 코드의 미검증 영역을 보고한다. 현재 수치는 보고용이며 임의의 최소 통과율을 설정하지 않았다. 기능별 중요 실패 경로가 검증되었는지와 수치를 함께 판단한다. 커버리지 명령은 `pnpm check`와 별도이며, 브라우저 smoke·네이티브 도구·실제 데이터 복구를 계측했다고 해석하지 않는다. React 수치는 Vitest 소스 테스트 기준이며 Compiler 적용 번들의 성능 수치가 아니다.

## 목업 브라우저 검사

먼저 `python3 mock/helpers/serve.py`로 정적 서버를 실행한다. 로컬 Chrome/Chromium과 `puppeteer-core`가 설치된 개발 도구 디렉터리가 필요하다. 이 도구는 제품 런타임에 포함하지 않는다.

```sh
export PUPUTYX_BROWSER_TOOLS="/absolute/path/to/browser-tools"
# 기본 경로에서 브라우저를 찾지 못할 때 설정한다.
# export CHROME_PATH="/absolute/path/to/chrome"

node mock/helpers/smoke.cjs
node mock/helpers/workspace-flow.cjs
node mock/helpers/search-editor.cjs
node mock/helpers/editor-basics.cjs
node mock/helpers/editor-failures.cjs
node mock/helpers/editor-chat.cjs
node mock/helpers/capture.cjs
```

`PUPUTYX_BROWSER_TOOLS`는 `node_modules/puppeteer-core`를 포함한 디렉터리다. 이미 모듈을 해석할 수 있는 환경에서는 생략 가능하다. `PUPUTYX_MOCK_URL`로 기본 `http://127.0.0.1:5174/`를 바꿀 수 있다.

| 검사 소스                                                                | 검증 대상                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [smoke.cjs](../mock/helpers/smoke.cjs)                                   | 주요 화면, 가이드·매핑, 메타데이터 등록, 샘플 생성, 대화 적용·복원, 내보내기, 직접 파일 열기      |
| [workspace-flow.cjs](../mock/helpers/workspace-flow.cjs)                 | 전역 탐색, 역할 미리보기, 단계 확인·변경 감지, 미저장 가이드, Space 처리                          |
| [search-editor.cjs](../mock/helpers/search-editor.cjs)                   | 검색 강조·fallback, 탭 키보드, draft 유지, 슬라이드별 Reference                                   |
| [editor-basics.cjs](../mock/helpers/editor-basics.cjs)                   | 메뉴·삽입·정렬·직접 텍스트·로컬 이미지·객체·undo/redo·배율                                        |
| [editor-failures.cjs](../mock/helpers/editor-failures.cjs)               | 텍스트·드래그 취소, 이미지 거부, redo 분기, 편집 후 화면 이동                                     |
| [editor-chat.cjs](../mock/helpers/editor-chat.cjs)                       | Ctrl/⌘ 다중 선택, 요청 범위 고정, 비대상 보존, 오래된 수정안 거부, IME 이벤트, draft 분리, 반응형 |
| [capture.cjs](../mock/helpers/capture.cjs)                               | 화면별 캡처, 넘침, 라이트 모드, 색 대비와 UI 상태                                                 |
| [check-production-theme.cjs](../mock/helpers/check-production-theme.cjs) | 빌드한 실제 React 화면의 테마; 별도 임시 서버·스토리지 사용                                       |

캡처는 `mock/captures/folio/`, 보고서·프로필·임시 다운로드는 `mock/helpers/.artifacts/`에 기록한다. 프로필은 브라우저 종료 시 정리한다. 각 검사 이후 남은 임시 파일을 확인하되 앱 데이터를 삭제하지 않는다.

자동 입력 이벤트 검사는 실제 한글 입력기·Safari·Firefox·스크린리더의 동작을 모두 입증하지 않는다. 30명 동시접속, 대형 문서, 장시간 세션과 이미지 누적 메모리 사용도 별도 검증 대상이다.

## 현재 보안 경계

| 경계          | 현재 보호                                                                                     | 한계                                                             |
| ------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 화면 입력     | HTML 이스케이프, 텍스트 붙여넣기                                                              | 서버 입력 검증·전체 XSS 감사 없음                                |
| 목업 네트워크 | HTML CSP의 `connect-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'` | 전체 스크립트·이미지 출처 정책이나 제품 서버 CSP를 대신하지 않음 |
| 문서 파일     | 확장자·크기·개수 검사, 메타데이터만 사용                                                      | 실제 MIME·악성 파일·압축 해제 검사 없음                          |
| 캔버스 이미지 | 유형·크기·화소 제한, 명시적 로컬 읽기, stale 완료 거부                                        | 누적 이미지·리비전·대화 전체 메모리 상한 없음                    |
| API Key       | 목업 설정 저장 시 비움, 외부 호출 없음                                                        | 비밀정보 암호화·키 회전·Secret 연동 없음                         |
| 역할          | 메뉴 숨김과 목업 라우트 전환                                                                  | 인증·서버 인가·개인 감사 아님                                    |
| 데이터 경로   | 절대 경로 요구, 인스턴스 잠금                                                                 | 파일 경로 격리·마운트·동기 쓰기·디스크 정책 검증 부족            |
| 리비전        | 인메모리 불변 deck 스냅샷과 대화 version 비교                                                 | 서버 동시성·영속 원자성·복구 보장 없음                           |

이미지가 포함된 JSON은 실제 이미지 내용을 담는다. 이 산출물은 민감 자료를 포함할 수 있는 문서로 취급한다. 브라우저의 샘플 역할을 서버 권한이나 업무 데이터 보호 수단으로 사용하지 않는다.

## 기업 운영 수용 조건

다음은 **미완료 운영 수용 기준**이다. 실제 구현과 재현 가능한 검증 증거가 확보되어야 완료로 판정할 수 있다.

| 영역        | 필요한 구현·검증                                                         | 완료 증거                                             |
| ----------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| 영속 데이터 | SQLite·refinery, FK·유일성, 불변 레코드, Blob 저장과 원자적 등록         | 중복 업로드·중단·충돌·Migration 검증                  |
| 스토리지    | 경로 포함 관계·심볼릭 링크, 실제 쓰기·fsync·rename, 용량·마운트 검사     | 잘못된 경로·미마운트·디스크 부족 시험                 |
| 백업·복구   | DB 일관 백업, 참조 Blob 보호, 키·파일 스냅샷, 복구 검증                  | 별도 환경 복구 및 참조·해시 검증                      |
| 업무 API    | 요청·응답 스키마, 오류 계약, 멱등성, 리비전 조건부 확정                  | 계약 테스트와 동시 변경·재전송 시험                   |
| Workflow    | 영속 노드·체크포인트, lease·heartbeat, 취소·재시도, 정의 버전            | 강제 종료·재시작·중복 실행·stale 결과 시험            |
| 파일 처리   | 형식 탐지, 자원·시간 제한, 프로세스 격리, OCR·변환 실패 복구             | 지원 형식·비정상 파일·제한 초과 문서 시험             |
| 모델 연동   | Provider 어댑터, Tool allowlist·스키마, timeout·fallback, 비밀정보 보호  | Provider별 계약, 악성 문서 지시와 비밀 유출 방어 시험 |
| PPTX        | 실제 편집 가능한 객체 생성, 원본 자료 삽입, 결과 재추출·검증             | PowerPoint 호환과 원본·근거 추적 검증                 |
| 접근 경계   | 사내 Ingress·Gateway의 네트워크 접근 제한; 앱 로그인·개인 권한은 범위 밖 | 외부 접근 차단·직접 API 노출·배포 구성 검토           |
| 성능        | 30명 동시접속, Pod CPU·메모리 예산, 큐·프로세스 상한, 편집 세션 메모리   | 대표 업무 부하와 장시간 실행 측정                     |
| 관측성      | 요청·프로젝트·작업 식별자, 민감정보 제외, 준비 상태·오류 지표            | 장애 재현과 추적 가능성 확인                          |
| 릴리스      | 런타임·OCR 모델 포함, 무결성 Manifest, SBOM·라이선스·취약점 검토         | 재현 빌드, 다운로드 없는 런타임 시작 시험             |
| 업데이트    | 지원 스키마 판독, 변환, 실행 중 작업 호환, 복구 절차                     | 지원 데이터셋 업그레이드·복구 연습                    |

현행 제품은 사내 공용 도구이며 별도 로그인과 사용자별 권한을 두지 않는다. 프로젝트와 구현된 기능은 접속자 사이에 공유된다. 내부망 접근 제한은 회사 인프라가 담당하고, 앱의 리비전·실행 기록으로 개인 신원을 증명하지 않는다.

허용 오류율·응답 지연·최대 문서 크기·보존기간·RPO/RTO는 확정된 운영 값이 없다. 위 수용 조건은 이러한 값을 임의로 가정하지 않으며, 서비스 수준이 정해진 뒤 해당 예산으로 검증해야 한다.

상세 요구사항은 [Workflow](../blueprint/04-workflow-engine.md), [데이터](../blueprint/05-data-storage.md), [LLM](../blueprint/06-llm-admin.md), [운영·배포](../blueprint/09-operations-delivery.md)에 정의되어 있다.

## 공유 프로젝트 기능의 수용 검사

[projects.rs](../backend/tests/projects.rs)는 공유 목록·생성 멱등성·검색/페이지·입력 검증·이름 변경 충돌·재시작 보존을 검사한다. [database_startup.rs](../backend/tests/database_startup.rs)는 독점 잠금·새 DB 버전 거부·Migration 이력 불일치·손상 DB 보존·Migration 전 백업을 검사한다.

[project-directory.test.tsx](../frontend/src/features/projects/project-directory.test.tsx)는 네트워크 결과가 불확실한 생성의 동일 키 재시도와 draft 보존·최신 revision 확인을 검사한다. 실제 shadcn/Radix 컴포넌트를 렌더링하며 native dialog 메서드 대체는 사용하지 않는다. overlay의 실제 초점·키보드·배치는 브라우저에서 검증한다.

```sh
pnpm build
pnpm test:e2e
```

[projects.cjs](../tests/e2e/projects.cjs)는 독립된 브라우저 컨텍스트 두 개를 사용해 로그인 없이 같은 프로젝트를 조회·변경하고, 충돌 검토와 서버 재시작 후 보존을 확인한다. 실제 shadcn dialog의 Esc·초점 복원, 이름의 HTML 이스케이프, 검색, 320~1440px 레이아웃을 검사한다. `PUPUTYX_BROWSER_TOOLS`와 `CHROME_PATH` 설정은 기존 브라우저 검사와 같다.

데이터는 `tests/.artifacts/`의 임시 서버 전용 경로에 만들고 종료 시 제거한다. 화면은 `mock/captures/folio/projects-*-production.png`와 `projects-shared-phone.png` 등에 저장한다. 제품의 실제 `data/`에는 QA 프로젝트를 만들지 않는다.

운영 수용표의 영속 데이터·스토리지 항목 중 프로젝트 V3와 기본 시작 검사는 구현되었다. 문서 Blob·일반 Workflow·전체 백업 복구·부하·런타임 번들에 대한 완료 판정은 별도다.

## 목업 프로젝트 메뉴·갤러리 검사

`node mock/helpers/project-menu.cjs`는 우클릭·더보기·키보드 메뉴, 대상 프로젝트 식별, 이름 변경·삭제 확인/취소, 마지막 프로젝트 삭제 후 재등록, 모바일 위치, 직접 파일 열기와 popover fallback을 검사한다.

`node mock/helpers/project-gallery.cjs`는 등록 시 종료일 누락 거부, 실제 브라우저 달력에서 선택, 3/2/1열 레이아웃, 6개 단위 페이지 이동, 종료일 범위·오류 복구, 한국·미국 시간대와 DST 경계의 날짜 차이를 검사한다. 데이터와 결과는 목업 메모리·캡처 경로에만 남으며 제품 DB는 변경하지 않는다.

`node mock/helpers/project-create.cjs`는 Home 상단 생성 버튼·native dialog 복귀 초점, 빈 공간/카드/키보드 우클릭, 빈 결과에서 등록, 입력창 기본 메뉴, 모바일·fallback·직접 파일 열기를 검사한다.

## 실제 Home 검사

[project_home.rs](../backend/tests/project_home.rs)는 잘못된 달력 날짜, 포함 기간 검색, 정렬, 이름/상태 변경 조건, 보관·복원·삭제 충돌, 삭제 재시도, tombstone 보존과 V1→V3 백업/이관을 검사한다. [home-checks.cjs](../tests/e2e/home-checks.cjs)는 실제 릴리스 서버에서 3/2/1열·6개 페이지, 보관/복원·정보 복사·삭제, 카드/빈 공간/키보드 메뉴, 필수 마감일과 shadcn 달력의 키보드 선택을 검사한다. `home-fallbacks.cjs`는 단일 마감일 일치 검색·URL 뒤로 가기·메뉴 키보드/포인터 동작과 native Popover/focusgroup/invoker 없이 동작하는 shadcn 경로, 실제 표면의 텍스트 대비를 검사한다. Vitest는 네트워크 실패 후 동일 생성 키 재시도·충돌 draft 보존·달력 날짜 차이를 검사한다.

현재 제품 캡처는 `home-production.png`, `home-production-phone.png`, `home-create-production.png`이며 `mock/captures/folio/`에 저장한다. 브라우저 검사는 로컬 Chrome에서 수행하며 Safari/Firefox와 실제 보조공학 수동 검증은 별도 수용 항목이다.

[project_due_migration.rs](../backend/tests/project_due_migration.rs)는 V2 날짜와 생성 요청 키를 V3로 이관하고, 기존 요청 재시도·조회 별칭·물리 컬럼 구조·백업 원본을 확인한다.

Home의 shadcn 회귀 검사는 실제 달력의 날짜 이동과 한국/미국 시간대 왕복, 메뉴의 포인터/키보드 진입, native Popover 비활성 환경에서도 유지되는 Radix 동작을 포함한다. 폼 검사는 응답 미확정 상태에서 Esc·취소가 저장 draft를 버리지 않는지도 확인한다.

Home route 청크 요청을 의도적으로 실패시키는 브라우저 검사는 오류 화면과 명시적 다시 불러오기 이후 복구를 확인한다. 모바일 메뉴는 Radix의 가용 폭 변수로 제한하고 실제 viewport 경계 안에 배치되는지 검사한다.

## Space 검증 경계

### 파싱 품질 보강 범위

우선 대상은 문서의 누락, 읽기 순서, 표·이미지와 원본 위치 연결이다. vLLM-SR 실엔진 검증은 보류하며 기존 어댑터와 계약 테스트는 유지한다. PDF 벡터 해석은 Kordoc에 위임하고 별도 벡터 복원 엔진을 만들지 않는다. Markdown 업로드는 별도 Comrak 어댑터로 구현하며 자체 문법 파서는 만들지 않는다. PDF 벡터의 편집 객체 제공은 구현 범위 밖이다.

현재 `tests/fixtures/documents`는 기본 기능 검사용 소형 합성 문서와 Kordoc 공개 HWP 회귀 예제를 포함한다. 이 폴더의 `scan.pdf`는 영어 합성 스캔이므로 한글 OCR 품질의 근거로 사용하지 않는다. 추가 [파싱 품질 검증 세트](../tests/fixtures/parsing-quality/README.md)는 한글 PDF/OCR·Office·공개 HWP/HWPX 7개 문서와 독립 작성한 예상 결과 27개 항목을 제공한다. 보강 문서는 다음 사례를 우선한다.

| 사례                                 | 비교할 예상 결과                                          |
| ------------------------------------ | --------------------------------------------------------- |
| 한글 텍스트 PDF·다단 문서            | 필수 문장, 읽기 순서, 페이지 연결, 반복 머리말의 구분     |
| 한글 스캔·텍스트/스캔 혼합 PDF       | 수작업 전사와 OCR 결과, 페이지별 누락·중복                |
| DOCX·HWP/HWPX 병합 표·본문 내 이미지 | 표 내용·행열 관계, 본문 순서, 이미지와 원본 위치          |
| XLSX 다중 시트·병합 셀·수식          | 시트 연결, 표시 값과 수식의 구분, 행열 순서               |
| PPTX 표·차트·중첩 그룹·회전 이미지   | 장표/요소 연결, 재사용 원본, 이미지 누락 및 미리보기 한계 |

공개/합성 fixture는 출처·이용 조건과 독립적으로 작성한 예상 결과를 함께 보관한다. 실제 업무 문서는 지정받은 원본을 읽기 전용으로 검토하며, 배포 fixture나 외부 모델 입력으로 자동 전환하지 않는다. 원본은 `tests/fixtures`, 일회성 실행 결과는 `tests/.artifacts`를 사용하고 앱의 `data/`에 QA 자료를 넣지 않는다. 추출 성공 여부와 품질 합격을 구분하며 기존 parser 결과를 그대로 정답으로 등록하지 않는다.

`pnpm audit:parsing`은 빌드된 실제 제품 서버에 순차 업로드하고 추출 결과를 API로 조회한다. 모델 연결은 생성하지 않으며 임시 저장소는 종료 시 제거한다. 품질 미달이 있으면 종료 코드 1과 상세 JSON/Markdown 보고서를 남긴다. 현재 세트는 27개 중 25개 검사를 통과한다. 이미지 연결·병합 셀 보존·한글 OCR·PPT 재사용 구조 검사는 통과하며 두 단 PDF 읽기 순서와 수식 별도 보존은 미달이다. 일반 `pnpm check`의 통과를 이 품질 기준의 통과로 대신하지 않는다.

[space.rs](../backend/tests/space.rs)와 지원 테스트는 실제 원본 저장/다운로드, 중복 제거, 요청 재전송·취소 경쟁, 파일 버전, 메타데이터 CAS, 논리 삭제, 정상 재시작, 중단된 staging/receipt 복구를 검사한다. 형식별 작은 구조 fixture로 허용/거부 경로와 ZIP 폭탄·경로 탈출·잘못된 PDF 등을 검사한다. 이 fixture는 복잡한 실무 Office 문서의 변환 호환성 증거가 아니다.

[upload-engine.test.ts](../frontend/src/features/space/upload-engine.test.ts)는 실제 Uppy queue의 라이브러리 간 독립 등록, 형식 제한과 서버 취소 결과를 검사한다. [space.cjs](../tests/e2e/space.cjs)는 격리된 릴리스 서버와 두 브라우저에서 업로드·바이트 일치 다운로드·버전·충돌·실패 재시도·논리 삭제·재시작·반응형을 검증한다. `pnpm test:e2e`는 Home과 Space를 순차 실행하며 생성 자료는 `tests/.artifacts/`에만 둔다.

남은 수용 범위는 대용량/다수 사용자의 자원 부하, 실무 HWP/HWPX·Office fixture 확대, 강제 종료/디스크 장애 전 구간, Linux Pod 및 파일시스템 검증, 원본/DB 전체 복구, 악성 파일 sandbox, 실행 중 수거와 삭제된 확정 버전의 물리 보존기간 관리다. 비동기 SQLite와 업로드 receipt를 전체 Workflow 복구 완료로 간주하지 않는다.

`upload-work-panel.test.tsx`와 Space E2E는 접기/닫기/다시 열기, 완료 항목 정리, 탭 격리, Home 이동과 모바일 패널 경계를 검사한다. `shared/notifications.test.ts`는 모달이 닫힌 뒤 알림 표시를 검사한다. `mock/helpers/work-feedback.cjs`는 직접 파일 열기에서 목업 작업·토스트 겹침과 초기화를 검사한다. 이는 계정 인증 테스트가 아니다.

HTML 원본 검증은 `backend/tests/space_support/html.rs`, Uppy 형식 테스트와 `tests/e2e/html-checks.cjs`가 담당한다. HTML/HTM, UTF-8/BOM, 태그 생략, 잘못된 인코딩/바이너리/markup 없는 문서, 복잡도 상한, 템플릿 거부, byte-exact 다운로드, 버전/재시작 보존과 첨부파일/CSP 헤더를 검사한다. 브라우저에서는 실제 파일 다운로드와 스크립트·외부 리소스 미실행, 다른 접속자의 공용 목록 표시를 확인한다. 실무 HTML 전체 호환성과 외부 브라우저에서 원본 파일을 여는 동작까지 보증하지 않는다.

## Provider 연결 검증과 남은 범위

- Rust `providers` 통합 테스트는 암호문 저장·재시작·키 누락/불일치 거부, 설정 CAS 충돌, 실행 중 설정 고정, 인증 오류·timeout·비정상/과대 응답·redirect 거부를 실제 로컬 HTTP fixture로 검증한다.
- React 테스트는 수정 draft 보존·최신 버전 검토·새 연결 UUID 재사용·저장 DTO에서 응답 전용 필드 제외를 확인한다.
- `tests/e2e/providers.cjs`는 컴파일된 UI와 격리된 제품 서버로 공유 설정, 모델 조회·text/JSON 테스트, 모바일·키보드·재시작을 검증한다. 테스트 서버 응답은 fixture이며 실제 모델 품질 증명이 아니다.
- `tests/e2e/provider-live.cjs`는 명시적으로 선택한 실제 LM Studio에 연결하는 별도 수용 검사다. Ornith 1.5 35B A3B Q4_K_M에서 텍스트와 status=ok JSON Schema 검증을 확인했다. 해당 샘플 통과는 문서 분석 정확도, Vision, Tool Calling, 장문 처리 또는 성능 보장이 아니다.

모델 라우팅·fallback, 스트리밍, Vision/Tool Calling, KMS·키 회전 및 대상 Linux 배포 검증은 남아 있다. 현재 제품 빌드의 공통 청크는 500 KiB 경고 기준을 초과한다. 추가 청크 분리와 실제 실행 성능 측정은 별도 개선 항목이다.

네이티브 계약 테스트 `native_providers`는 8개 Provider의 endpoint·인증·JSON Schema 직렬화·최종 텍스트·usage 변환, 모델 목록 페이지 처리, reasoning 비노출, 미완료·차단 응답, 인증 누락, LM Studio Native의 미지원 구조화 요청을 검증한다. `provider_migration`은 V5/V6의 실제 암호문·설정 UUID·요청 FK와 백업을 최신 스키마에서 확인한다.

LM Studio Native의 Ornith 텍스트는 실제 서버로 검증했다. OpenAI·Claude·Gemini와 llama.cpp·SGLang·vLLM·LiteLLM은 로컬 HTTP fixture 계약 검증이며 실제 키/해당 서버 환경의 수용 검증은 남아 있다. 전체 문서 분석 제품이 완료된 상태는 아니다.

Admin 레이아웃 검증은 탭 이동 중 테스트 상태 보존, 숨긴 이력의 조회 억제, 메뉴·탭의 URL/뒤로 가기/새로고침 복원, 수동 활성화 키보드 동작, 하나의 main landmark, 메뉴 접기·펼치기와 모바일 너비를 포함한다. 시스템 상태는 기존 Health 응답·취소·재시도 테스트를 공유한다.

책임 경계 검증은 진단 문자열과 무관한 일반 추론 실행, 공통 schema 거부 시 실패 기록, 종료 취소 후 Provider 미실행, 카탈로그의 모든 ID 저장·unknown ID 거부, 시작 복구 시 미완료 행만 변경을 포함한다. React에서는 카탈로그 실패 시 생성 차단과 명시적 재시도를 검증한다. 기존 native protocol/암호화/버전 충돌/리비전 보존 검사는 같은 API 계약으로 유지한다.

## Decision 검증 범위

`backend/tests/decisions.rs`는 9개 native kind와 LLM bridge의 단일 배치 호출, OpenAI 배열/Gemini input 변환, 인증 헤더, 확률 미제공과 Provider 보고값 구분, 누락·추가·잘못된 선택지·분포·refusal·중복 JSON 거부를 실제 HTTP로 검증한다. 설정 변경 중 고정 리비전 유지, 종료 후 이력 보존, 미지원 입력의 호출 전 거부도 포함한다. fixture 통과는 실제 Provider 계정 접근이나 사내 문서 정확도를 보장하지 않는다.

React 검증은 판정 입력의 제출 후 오류·포커스, 결과의 draft 변경 시 제거, 대기 취소와 미지원 연결 차단, LLM/System One 전환 시 키 재사용 방지를 포함한다. `tests/e2e/decisions.cjs`는 real-server Admin 설정·판정·실패 재시도·독립 브라우저 공유·재시작·모바일을 확인한다. 캡처는 `mock/captures/folio/admin-decisions-production.png`, `admin-decisions-phone.png`이며 로컬 fixture 결과다.

로컬 수용 검사 `decision-live.cjs`는 명시적으로 지정한 localhost LLM 호환 연결에만 샘플을 보낸다. Ornith 1.5 35B A3B Q4에서 두 영역을 한 배치로 판정해 목차 1·본문 0을 확인했다. 이 샘플은 전반적인 분류 정확도 평가나 native System One 지원 검증이 아니다.

## 문서 처리와 템플릿 미리보기 검증

`document_processing.rs`는 실제 Kordoc/PPT Master와 PDF·스캔 OCR·DOCX·XLSX·HWP/HWPX·HTML fixture를 사용한다. 템플릿은 LLM 호출이나 레퍼런스 블록 생성 없이 구조와 장표 PNG를 만들고, PPTX 레퍼런스는 본문과 네이티브 재사용 자료를 준비하되 템플릿으로 등록하지 않는 분기를 검사한다. PNG는 해당 템플릿 작업에서만 읽을 수 있고 다른 작업을 통한 조회는 거부한다.

`document_recovery.rs`는 완료 배치 재사용, 실행 중 설정 리비전 고정, 재시작, 잘못된 모델 결과를 0으로 기록하지 않는 동작을 확인한다. `processing.test.tsx`는 기술 용어 비노출, 장표 전환, 선택 상태, 실측 진행률 및 충돌 처리를 검사한다. `document-processing.cjs`는 격리된 제품 서버에서 업로드·준비 대기·Admin 설정·내용 검색·템플릿 PNG·재시도·탭별 작업 패널·공용 결과·재시작을 검증한다.

실무 문서 전반의 조판 충실도, PowerPoint 고급 효과·폰트 대체, Office PDF 정규화, 전체 DAG·Studio 생성, 30명 부하 및 Linux Pod 수용 검증은 남아 있다. 미리보기는 PPT Master의 렌더링 결과이며 원본 PowerPoint와 픽셀 일치를 보장하지 않는다.

## 일반 사무직 사용자 경험

목업의 일반 사무직 경험은 전체 화면의 표시 문구 감사, 생성·취소·재시도, 작성 방향 저장 보호, 참고 자료 선택, 편집·다중 선택·복원, Admin 상세 입력, 샘플 표시, 데스크톱·모바일·직접 파일 열기로 검증한다. 자동 테스트는 실제 사무직 사용자의 이해도 검증을 대신하지 않는다.

`mock/helpers/office-language.cjs`는 16개 경로의 데스크톱·모바일 화면과 주요 대화 상자·진행 상태를 합쳐 43개 표시 지점을 검사한다. `capture.cjs`는 32개 화면의 라이트 테마·가로 넘침·표 이름과 대비를 확인한다. 이 검사는 목업 범위이며 제품 React 전체의 문구 전환을 완료했다는 뜻은 아니다.

## 연결별 처리 한도 검증

`model_execution/admission_tests.rs`는 FIFO, 연결 간 독립성, 가득 찬 대기열, 한도 축소·증가, 이전 설정 무시, 취소·종료·대기 timeout과 허가 직후 취소 시 예약 반환을 검사한다. `backend/tests/model_capacity.rs`는 실제 SQLite/HTTP에서 저장·충돌·재시작, LLM/System One 공통 적용, 대기 중 모델 설정 고정과 외부 호출 전 취소를 확인한다.

React 검증은 입력 보존·공유 변경 검토·저장 실패와 비활성 탭 조회 억제를 포함한다. `tests/e2e/model-capacity.cjs`는 두 브라우저, 실제 대기 요청·429, 독립 System One 호출, 실시간 수치, 숫자 입력 제약, 모바일과 재시작을 확인한다. 로컬 HTTP fixture를 사용하며 1024개 요청 부하 시험이나 외부 엔진의 처리 성능을 증명하지 않는다.

### 재사용 자료 검증

`reference_materials`는 실제 PPT Master/Kordoc으로 두 장표·이미지·차트·그룹 도식·글의 catalog, 원본 미디어 바이트 보존, 역순 장표 선택, source/version 고정, 다른 원본 ID·Blob 거부, 재시작·추출 캐시 재사용을 검사한다. V10 schema 1 fixture의 V11 migration은 기존 원문과 원본을 유지하고 명시적인 준비 요청에서만 새 추출을 만든다. React와 `tests/e2e/reference-materials.cjs`는 여러 자료 선택·확대 검토, 독립 브라우저 선택, 오류·취소, 지연 이미지, 키보드·모바일을 검증한다.

PPTX 자체는 네이티브 재사용 구조를 보존한다. 실제 생성 덱에 여러 장표·요소를 삽입하고 편집 가능한 PPTX를 내려받는 기능은 아직 아니다. PDF 벡터 도식의 독립 객체 분리, 회전/복합 그룹의 완전한 crop 충실도, 전체 실무 문서·폰트·효과에 대한 수용 검증도 남아 있다.

Kordoc 이미지 필터 검증은 단색 배경 제외, 작은 고대비·투명 아이콘 보존, 공개 문서 parse 옵션 적용과 본문 유지, 네이티브 레퍼런스 후보의 필터 우회 방지, 원본 미디어 보존을 확인한다. `pnpm check`가 `tests/helpers/kordoc-image-filter.mjs`와 실제 문서/레퍼런스 통합 검사를 실행한다. 크기만 작은 모든 이미지나 개별 벡터 도형을 제외하는 필터는 아니다.

## 저장 중복과 수거 검증

`shared_ppt_storage.rs`는 같은 PPTX의 레퍼런스·템플릿 동시 처리, 공통 추출 한 건, 재시작·다른 등록에서의 재사용, 서로 다른 원본의 동일 이미지 Blob 공유, 결정적 ZIP 다운로드, 영구 ZIP 미생성을 검사한다. V11 템플릿 JSON/ZIP fixture를 V12로 업그레이드하고 기존 미리보기·다운로드가 그대로 동작하는지 확인한다. `reference_materials.rs`는 구성 이미지 바이트와 원본의 일치, 자료 선택 순서·범위·재시작을 계속 검사한다.

`blob_collection.rs`는 첫 관찰 보존, 7일 경과 후보 수거, 새 참조 보호, 백업에만 남은 참조 보호, 손상 백업에서 수거 생략, 심볼릭 링크 경로 거부를 실제 임시 저장소에서 검사한다. 이 테스트는 전체 백업 복구, 실무 대용량 자료 부하 또는 외부 백업 시스템 수용을 대신하지 않는다.

## Studio 검증

`studio_sources.rs`는 프로젝트 간 파일 범위, 업로드 멱등성과 scope 충돌, Space 비등록, 동일 원본 추출 공유, 파일 교체 CAS, 과거 원본 다운로드, snapshot 확인/무효화, Do/Don’t 충돌·재시작, 프로젝트 삭제 후 문서 접근 차단을 실제 서버/로컬 도구로 검증한다. 기존 Space·문서·V11 패키지 호환 fixture도 V13 경로를 통과한다.

`studio.test.tsx`는 방문만으로 확인하지 않음, 빈 원본 확인 차단, 명시적 snapshot 확인 후 작성 방향 이동, 충돌 후 입력 보존을 검사한다. `tests/e2e/studio.cjs`는 Home 생성 후 진입, 두 브라우저의 공유 파일/개별 작업 패널, 실제 PDF 갤러리, 교체·이전 원본, 가이드 저장, 모바일과 서버 재시작을 검사한다. 캡처는 mock/captures/folio/studio-*.png에 저장한다. Studio의 목차·PPT 생성이나 전사 의미 검색 완료를 뜻하지 않는다.

`tests/e2e/mobile-work-panel.cjs`는 실제 프로젝트 업로드 후 320/390px에서 펼침·접힘·닫힌 런처가 화면 하단에 밀착되는지, 마지막 원본 확인 버튼이 도크 위로 스크롤되는지, 낮은 viewport에서 패널 내용 높이가 제한되는지 확인한다. 데스크톱의 기존 위치와 하단 여백 복구도 검사한다. 모바일 캡처는 viewport 기준이며 실제 기기 키보드·노치의 하드웨어 검증을 대신하지 않는다.

## 관계 검색 검증과 운영 수용 범위

`related_documents.rs`, `related_recovery.rs`, `related_scope.rs`는 실제 파일/프로젝트 API와 검증용 native Decision/구조화 LLM HTTP 서버로 다음을 확인한다: native 후보별 병렬 입력, LLM 최대 8개 묶음, 연결 동시성 준수, 동일 검색의 추가 호출 0, 출처 그룹화, 키워드가 다른 후보 포함, 부분 실패 재시도, 취소 후 늦은 답변 차단, 재시작 시 최초 모델 설정 유지, 조건부 선택/설정, 보관·형식·시기·프로젝트 필터와 삭제 후 참조 보존. 오류 응답을 관계 0으로 저장하지 않는다.

`retrieval/tests.rs`는 10,000개 합성 텍스트 블록으로 실제 후보 SQL 20회를 실행하고 FTS virtual index 사용, 조회 지연 분포, 메타데이터 증가와 원문 행 수 불변을 `tests/.artifacts/relations-query-benchmark.json`에 기록한다. 이 수치는 SQL-only fixture 결과이며 실무 전체 corpus나 모델 응답 지연의 SLA가 아니다. 클라우드 모델 요금·실제 문서의 관계 정확도·30명 부하는 별도 수용 대상이다.

`related.test.tsx`와 실제 서버 `tests/e2e/related-documents.cjs`는 명시적 실행, 같은 불확실 요청의 재전송, 프로젝트 소속, 공유 선택, 과거 버전/페이지 미리보기, native/fallback 텍스트 강조, 모바일 및 재시작을 검사한다. 모델 fixture는 계약·실행 검증용이며 의미 정확도를 증명하지 않는다.

현재 로컬 D3 Flash의 작은 합성 질문은 native 응답을 반환하지만 더 큰 입력은 LM Studio에서 `non-causal attention requires n_ubatch >= n_tokens` assertion으로 실패했다. 이는 관찰된 내부 처리 배치 제약이며 단순 context length 초과로 단정하지 않는다. 실사용 전 해당 런타임의 입력/배치 수용을 확인해야 한다. 앱은 이를 실패로 표시하고 성공한 판정만 유지한다. 진단 중 모델을 다시 로드하거나 엔진 설정을 변경하지 않았다. API가 허용하는 입력 바이트 한도는 모델의 토큰 문맥 한도를 보장하지 않는다.

## vLLM-SR 연결 검증

`vllm_sr.rs`는 Router/standalone 모델 목록, System Two·choice 미지원 제외, Bearer/무키 로컬 연결, 404/405만 허용하는 목록 경로 전환, 잘못된 ID·초과 목록·인증·과부하·서버 오류와 조회 무부작용을 검사한다. `decisions.rs`는 JSON 문자열 state, 선택값·확률·usage와 실행 이력 보존을 검사한다. `provider_migration.rs`는 V14→V15에서 암호문·요청·검색 config 참조와 연결별 처리 설정을 보존하는지 검사한다.

`tests/e2e/vllm-sr.cjs`는 실제 Rust/React와 격리된 계약 서버로 Admin의 조회→선택→저장→판정, 동시성/대기열, 문서 처리·자료 찾기 선택, 독립 브라우저 공유, 모바일과 재시작을 확인한다. 이는 실제 vLLM-SR 모델의 정확도·지연시간이나 인증된 공개 호스팅 추론 성공을 의미하지 않는다.

## Markdown 입력 검증

`markdown_documents.rs`는 실제 업로드·추출·SQLite에서 UTF-8/BOM·확장자, 제목/목록/체크리스트/인용/코드/표·원문 위치, FTS 검색, 원본 attachment·CSP, Studio/Space 간 정본 재사용, 새 버전·재시작 보존을 검사한다. 같은 HTML/Markdown 바이트를 두 순서로 등록해 Blob은 공유하면서 MIME·추출 결과는 분리되는지 확인한다. 잘못된 인코딩·바이너리·공백 파일·크기·줄 길이 제한과 템플릿 거부도 포함한다.

`upload-engine.test.ts`는 두 Markdown 확장자·종류 제한·클라이언트 2 MiB 검사를 확인한다. `tests/e2e/markdown.cjs`는 실제 두 브라우저에서 Space/Studio 업로드, 안전한 텍스트 표시, 원문/코드·검색, 외부 이미지 요청·스크립트 실행 없음, 프로젝트 원본의 Space 비등록, 모바일과 재시작을 확인한다. LLM 또는 vLLM-SR 엔진 검증을 의미하지 않는다.

## Space 통합 검색 검증

`library_search.rs`는 실제 자료의 파일 정보/본문 일치, 템플릿 범위와 미리보기, 정확한 작업/페이지 참조, 프로젝트 원본 제외, 조건 검증, 보관 상태, 최신 버전, 페이지네이션·재시작과 모델 호출 없음 여부를 검증한다. `features/search/search.test.tsx`는 명시적 제출·IME·안전한 본문·모달 없는 상세 링크를 검사한다. 공유 강조 표시의 수명·미지원 fallback은 기존 관계 검색 검사를 유지한다.

`tests/e2e/library-search.cjs`는 합성 자료와 실제 제품 서버로 상단 입력→뉴스형 결과→독립 문서 페이지→검색 복귀, 종류 탭·URL 뒤로 가기·페이지네이션, 독립 브라우저 공유, 모바일과 재시작을 확인한다. 이 검색은 기존 FTS/파일 정보를 사용하며 의미 관계 판정이나 템플릿 본문 전체 검색의 검증은 아니다.

## 목차·콘텐츠 구성 검증

`outlines.rs`는 실제 원본·확인·가이드·LLM 계약을 통해 생성, 수동 저장/충돌, 변경 없는 노드 재사용, 전체 매핑, 다중 연결, 미연결 확정 거부, 과거 버전, 가이드 변경 시 재검토와 재시작 보존을 확인한다. `outline_recovery.rs`는 실패 배치만 재시도, 취소 뒤 늦은 결과 거부, 생성 중 수동 편집 보호, 설정 변경/재시작 시 최초 모델 구성 유지를 검사한다. `outline_native.rs`는 네이티브 LM Studio JSON 지시/서버 검증과 잘못된 응답 거부를 계약 서버로 확인한다.

React 검사는 필요할 때 여는 목차 편집·원문 선택, 서버 변경에도 편집 입력 보존, 명시적 확정, 하나의 원문을 여러 목차에 연결, 부모/자식 순서 보존, 미저장 가이드의 다음 단계 차단을 포함한다. `tests/e2e/outlines.cjs`는 실제 UI에서 원본 등록부터 목차 생성·수정·순서·자동/수동 연결·확정·과거 버전, 대화상자 닫기/Escape 후 초점 복귀와 입력 유지, 독립 브라우저 공유·가이드 재검토·모바일·재시작까지 확인한다. AI 응답은 합성 계약 서버이며 실제 모델의 의미 정확도를 증명하지 않는다.

`document-structure.test.mjs`, `extracted-table.test.tsx`, `tests/e2e/source-structure.cjs`는 이미지 연결, 중첩/병합 정보, 한글 셀 범위, 원문 HTML 미실행, 병합 표·이미지 실제 표시, 키보드 스크롤과 모바일 범위를 검사한다. 회귀 fixture와 실무 문서/폰트/원본 조판 수용 검증은 구분한다.

## 확장 검색 검증

related_exploration.rs는 주변 문맥 재검토, 다른 자료의 비교 문맥, 최초 후보 밖의 문서 추가, 잘못된 계획 뒤 완료 결과 재사용, 예산 종료, 출처 소속과 재시작 보존을 검증한다. related-exploration.cjs는 Admin의 두 모델 선택, 실제 검색, 원문 지연 조회·미리보기, 공유 선택, 모바일과 재시작을 확인한다. Space 검색에 프로젝트 원본이 섞이지 않는 검사도 포함한다.

합성 모델과 격리된 문서의 계약·동작 검증이며 논문 성능을 제품 성능으로 주장하지 않는다. 실제 사내 문서의 근거 정확도·누락률·모델별 비용/지연 검증은 별도다. 무제한 탐색·모든 문서 쌍 비교·이미지 의미 판정은 현재 범위가 아니다.

## 발표자료 생성 검증과 수용 경계

`backend/tests/presentations.rs`, `presentation_templates.rs`는 합성 LLM과 실제 번들 렌더러/Kordoc으로 원본·목차·근거·템플릿 고정, 출력 파일의 네이티브 텍스트, template master 보존, 중복 요청, CAS, 취소·재시도·재시작, canonical citation과 과거 결과 유지 계약을 검증한다. `tests/e2e/presentations.cjs`는 원본 업로드부터 PPT 다운로드까지 실제 Rust/React 흐름, 별도 브라우저 공유, 작은 화면과 재시작을 검사한다. QA 파일은 tests/.artifacts, 화면은 mock/captures/folio에 저장한다.

이 검증은 실모델의 요약 품질·근거 충실도나 PowerPoint/Keynote 전 버전의 시각적 동일성을 증명하지 않는다. 현재 자동 검사는 편집 가능한 텍스트 존재·장수·Kordoc 재추출 제목/본문 누락을 확인하며 시각 모델 검사는 없다. 실제 사내 문서·회사 템플릿, 설치 폰트, 30명 부하와 Linux Pod 번들에 대한 운영 수용 검증은 별도다.

## Admin 접근 검증

`backend/tests/admin_access.rs`는 인증 없는 전체 Admin namespace 차단, 잘못된 토큰/시도 제한, 유효 토큰, 재시작 교체, 공개 모델 DTO의 주소/비밀 제외를 검사한다. 기존 기능 테스트는 해당 서버 인스턴스의 실제 토큰을 사용하며 인증 우회 모드는 없다. `tests/e2e/admin-access.cjs`는 토큰 폼, 다른 브라우저, Admin 이탈·새로고침·명시적 잠금·서버 재시작을 검증한다. 토큰 입력 확인은 독립 사용자 계정이나 개인 신원 감사 기능을 뜻하지 않는다.
