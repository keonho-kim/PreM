# 의존성 구성과 도입 기준

## 적용 범위

본개발의 저장·실행 경계와 React 검증에 사용하는 의존성을 설치했다. Provider HTTP와 Secret 암호화 의존성은 실제 Admin 연결 기능에서 사용한다. 버전은 manifest와 lockfile로 고정한다. **설치와 기능 구현은 구분한다.** 서버 시작에서 프로젝트 DB와 Migration을 실행하며 UUID와 typed error를 실제 기능에서 사용한다. Provider별 네이티브/공식 API 연결·텍스트·지원되는 구조화 응답 테스트를 구현했다. 문서 추출·분류, 관계 검색과 목차·콘텐츠 연결은 실제 기능이다. PPT 생성·편집은 후속 구현 범위다.

소스 책임·port·트랜잭션 설계는 [본개발 소스 아키텍처](../blueprint/02-system-architecture.md), 현재 코드의 실제 위치는 [구현 아키텍처](01-architecture.md)를 따른다. 운영용 DB나 임시 제품 Migration을 패키지 검증 목적으로 생성하지 않는다.

## 사용 범위와 선정 우선순위

PuPuTyX는 **같은 회사 안에서 우리 팀이 사용하는 공용 도구**다. 판매·고객사 배포·외부 사용자 대상 SaaS는 현재 범위가 아니다. 문서의 빌드/배포본은 팀 서버에 설치할 내부 실행 패키지를 의미한다.

선정 기준은 실제 문서 처리 품질, 로컬 실행과 데이터 보존, 연동·설치 편의성, 유지보수·자원 비용 순으로 잡는다. 상업용 폐쇄 소스 솔루션의 고객 재배포 조건을 기본 전제로 삼지 않는다. GPL/MPL/AGPL도 실제 사용 조건에 맞으면 채택하며, 라이선스 계열만으로 유용한 오픈소스를 미리 제외하거나 유료 라이선스를 필수화하지 않는다.

[GNU GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html#InternalDistribution)는 한 조직 내부의 복사·사용과 외부 전달을 구분한다. 다만 사내 사용이 모든 조건의 면제를 뜻하지는 않는다. 특히 [AGPL 13조](https://www.gnu.org/licenses/agpl-3.0.html#section13)의 네트워크 상호작용 조건 등은 수정·결합·서비스 형태에 따라 확인한다. 필요한 고지와 내부 소스 제공 방법을 실제 구성에 맞춰 관리하며, 공개 인터넷에 모든 사내 코드를 게시해야 한다거나 아무 의무도 없다고 일괄 판단하지 않는다. 외부 배포·접속 범위가 실제로 변경될 때 해당 조건을 다시 검토한다.

**기본 결정은 적합한 오픈소스의 적극 도입이다.** 필수 결제/유료 라이선스가 필요한 경로와 우리 사용을 허용하지 않는 코드·자산은 제외한다. 유료 옵션이 있다는 이유만으로 무료 오픈소스 경로까지 제외하지 않는다. 라이선스 계열 자체를 보류 사유로 삼지 않고 필요한 조건을 충족하는 방향으로 연동한다. 공개 저장소에 있다는 사실만으로 사용 허가가 있다고 가정하지는 않는다.

보류에는 실제 이유를 붙인다. 예를 들어 peer/ABI 불일치, 실행 불가, 같은 기능의 중복 엔진, 과도한 자원 비용, 현재 기능과 무관함은 보류 사유다. 막연한 상업화 우려는 현재 팀 도구의 보류 사유가 아니다.

기술적 호환성, 모델/폰트 조건, 필수 보안·데이터 무결성 검사는 사내 도구에서도 유지한다. 아직 쓰지 않는 패키지를 전부 설치하거나 고객용 다중 환경·테넌트·라이선스 관리 기능을 추가하지 않는다.

## Backend에 연결된 Rust 의존성

[workspace manifest](../Cargo.toml)는 버전·feature의 원본이며 [backend manifest](../backend/Cargo.toml)는 제품 패키지에서 이를 상속한다. 새 직접 의존성은 exact version을 사용한다.

| 패키지               | 고정 버전 | feature·기본 기능        | 본개발 소비 책임                            |
| -------------------- | --------- | ------------------------ | ------------------------------------------- |
| `async-sqlite`       | 0.7.0     | defaults off             | SQLite 전용 스레드·bounded queue·async 응답 |
| `rusqlite`           | 0.41.0    | `bundled`, `backup`      | SQLite adapter의 연결·SQL·일관 백업         |
| `refinery`           | 0.10.0    | defaults off, `rusqlite` | SQLite adapter의 내장 Migration             |
| `tokio-util`         | 0.7.20    | `rt`, `io`               | 취소·owned task 대기·stream I/O             |
| `schemars`           | 1.2.3     | derive 포함 기본 기능    | Tool·구조화 산출물 JSON Schema              |
| `jsonschema`         | 0.61.2    | defaults off             | 등록된 schema의 로컬 검증                   |
| `futures-util`       | 0.3.34    | defaults off, `std`      | 비동기 스트림 조합                          |
| `eventsource-stream` | 0.2.3     | 기본 기능                | Provider 응답의 SSE 파싱                    |
| `tempfile`           | 3.27.0    | runtime + dev            | Blob staging·임시 ZIP·통합 테스트           |

기존 `serde_json`은 테스트 전용에서 제품 dependency로 이동했다. Axum에는 multipart 파싱 feature를, Tokio에는 `fs`, `io-util`, `process`, `sync`, `time`을 추가했다. 파싱 feature를 켜는 것만으로 업로드 경로나 크기 제한 middleware가 등록되지는 않는다.

`uuid` 1.29.2와 `thiserror` 2.0.21은 프로젝트 식별자·생성 키·백업 파일명과 feature 오류를 위해 backend에 직접 연결되어 있다.

### Provider 연결에 설치된 패키지

| 패키지           | 고정 버전 | 실제 소비자                                                                                           |
| ---------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| reqwest          | 0.13.5    | OpenAI 호환 모델 목록·Chat Completions, Rustls TLS, 요청 timeout·크기 제한·모델 목록 query pagination |
| secrecy          | 0.10.3    | 복호화된 인증 토큰과 키의 메모리 수명                                                                 |
| chacha20poly1305 | 0.11.0    | API Key의 XChaCha20Poly1305 인증 암호화, zeroize feature                                              |
| getrandom        | 0.4.3     | OS 난수 기반 32바이트 키와 매 암호화의 24바이트 nonce                                                 |
| url              | 2.5.8     | HTTP(S) Base URL 정규화·인증 정보/쿼리/fragment 거부                                                  |

reqwest는 MIT/Apache-2.0, secrecy는 MIT/Apache-2.0, RustCrypto와 getrandom은 MIT/Apache-2.0, url은 MIT/Apache-2.0이다. chacha20poly1305 0.11.0과 getrandom 0.4.3의 MSRV는 1.85이며 현재 Rust 1.99에서 빌드한다. RustCrypto는 기본 feature를 끄고 alloc/zeroize만 사용한다. HTTP·암호화 소비자는 Rust에 컴파일되며 프론트 SDK나 추가 범용 훅은 도입하지 않았다. [RustCrypto 0.11.0](https://docs.rs/chacha20poly1305/0.11.0/chacha20poly1305/), [getrandom](https://docs.rs/getrandom/0.4.3/getrandom/)

reqwest/Rustls의 전이 의존성인 aws-lc-rs/aws-lc-sys·rustls-webpki·untrusted는 ISC 고지를 포함하고 webpki-root-certs의 인증서 데이터는 CDLA-Permissive-2.0이다. 실제 패키지의 LICENSE를 확인하고 deny.toml의 검토된 허용 목록에 추가했다. 라이선스·저작권 문구를 릴리스의 의존성 고지와 함께 보존하며 advisory 검사는 계속 활성화한다.

### SQLite와 Migration 호환성

refinery의 SQLite driver는 특정 rusqlite 범위만 지원한다. 설치 시 직접 `rusqlite`와 `refinery-core`가 **하나의 rusqlite 및 libsqlite3-sys**를 공유하도록 맞췄다. 현재 lockfile은 refinery 0.10.0, refinery-core 0.10.1, rusqlite 0.41.0의 조합이다. 독립적으로 최신 rusqlite를 선택하지 않는다.

검증 명령:

```sh
cargo tree --locked -i rusqlite
cargo tree --locked -i libsqlite3-sys
cargo test --workspace --locked --test dependency_contracts
```

bundled SQLite는 배포 시스템의 SQLite 라이브러리에 의존하지 않게 한다. SQLite C 소스를 빌드하므로 개발·빌드 환경에는 C 컴파일러가 필요하다. 실제 WAL·FTS5·FK·Migration 재실행·백업 판독은 [계약 테스트](../backend/tests/dependency_contracts.rs)에서 함께 검사한다. [refinery 레지스트리](https://crates.io/crates/refinery), [refinery-core 0.10.1 의존 정보](https://crates.io/api/v1/crates/refinery-core/0.10.1/dependencies), [rusqlite](https://github.com/rusqlite/rusqlite)

### HTTP·Schema·Secret 경계

reqwest는 공유 비동기 client로 사용한다. system proxy·redirect·자동 retry는 비활성화하고 연결 timeout은 5초, 전체 요청은 설정된 5~180초로 제한한다. 응답은 최대 512 KiB까지 읽는다. API Key는 Authorization 헤더로만 전달하고 upstream 오류 body·reqwest URL 오류는 그대로 공개하지 않는다. HTTP(S) 내부망·loopback 주소를 허용하므로 접근 제어는 회사 네트워크에서 제공한다. [reqwest features](https://docs.rs/reqwest/0.13.5/reqwest/)

jsonschema의 기본 HTTP·파일 `$ref` 자동 조회는 비활성화했다. 등록된 schema와 명시적으로 제공한 resource를 검증하고, 미등록 외부 참조는 실패시킨다. schemars가 생성한 schema와 validator의 호환성, 잘못된 입력·추가 필드·외부 참조 거부를 테스트한다. [jsonschema](https://docs.rs/jsonschema/0.61.2/jsonschema/)

secrecy는 토큰과 키의 메모리 취급을 돕고, XChaCha20Poly1305가 API Key를 암호화한다. config revision UUID를 AAD로 묶으며 DB에는 `v1:nonce:ciphertext` envelope만 저장한다. 기본 키는 `config/secret.key`, 외부 키는 APP_SECRET_KEY_FILE로 지정한다. KMS·자동 키 회전은 미구현이다. [secrecy](https://docs.rs/secrecy/0.10.3/secrecy/)

### 실행 수명과 SSE

CancellationToken과 TaskTracker는 앱이 소유한 비동기 작업의 취소 신호·종료 대기에 사용한다. DB lease, 프로세스 그룹 종료, checkpoint, 재시작 복구는 별도 구현이다. [TaskTracker](https://docs.rs/tokio-util/0.7.20/tokio_util/task/struct.TaskTracker.html)

eventsource-stream은 외부 Provider의 응답 파서다. 브라우저로 전달하는 제품 SSE는 Axum과 영속 이벤트 이력으로 구현한다. 파서 도입만으로 재연결·중복 제거·이벤트 영속성이 생기지 않는다.

## 제품 컴포넌트 기준: shadcn/ui와 AI Elements

일반 React UI는 **공식 shadcn/ui 컴포넌트**를 사용한다. [components.json](../frontend/components.json)의 `new-york`/Radix 구성을 유지하며, Home은 Button·Input·Label·Select·Dialog·Alert Dialog·Dropdown Menu·Context Menu·Popover·Calendar·Pagination·Card를 실제로 소비한다. 공식 registry 소스를 가져와 Folio 색·44px/48px 대상·한국어·접근성을 조정하고 미사용 하위 컴포넌트/exports를 제거했다.

공급원별 URL과 원본 registry JSON의 SHA-256은 [components.sources.json](../frontend/components.sources.json), MIT 고지는 [THIRD_PARTY_NOTICES.md](../frontend/THIRD_PARTY_NOTICES.md)에 보관한다. 패키지와 달리 복사한 UI 소스는 이 저장소가 소유한다. Calendar의 custom component는 모듈 수준으로 옮겨 React Compiler와 재렌더 상태 보존을 지원한다.

직접 추가한 실행 의존성은 `@radix-ui/react-dialog`, `react-alert-dialog`, `react-dropdown-menu`, `react-context-menu`, `react-popover`, `react-select`, `react-label`, `react-tabs`, `react-progress`, `react-day-picker`, `date-fns`다. 모두 MIT이며 설치 시 React 19 peer와 버전을 확인해 manifest/lockfile에 exact version으로 고정했다. `date-fns`는 한국어 달력 locale의 실제 소비자다. shadcn CLI를 운영 의존성으로 추가하지 않았다.

마감일은 `due-date-picker.tsx`에서 Input·Popover·Calendar로 조합한다. YYYY-MM-DD 문자열을 Date 객체로 바꾸는 경계는 UTC로 고정하고 오늘 표시는 브라우저 현지 날짜를 따른다. 연도 직접 이동·월 선택·날짜 버튼·키보드 선택을 제공하며 DB/API의 단일 `due_date`는 바뀌지 않는다. 입력과 이름 변경/삭제의 오류·재시도·충돌은 feature가, overlay·방향키·dismiss·focus scope는 Radix가 소유한다.

AI UI의 선택은 [shadcn/ui AI Elements](https://ui.shadcn.com/docs/ai-elements)다. 공식 문서상 AI Elements는 shadcn 컴포넌트를 조합해 프로젝트에 복사하는 패턴이며 별도의 일괄 런타임 패키지가 아니다. 기존 [Vercel AI Elements](https://github.com/vercel/ai-elements/blob/main/README.md)는 shadcn/ui로 이전 중이며 2026년 11월 말 deprecated 예정으로 안내한다. 신규 도입은 shadcn 공식 패턴을 기준으로 한다. 현재 제품은 공식 Message/Bubble/Message Scroller/InputGroup 소스를 사용하며 AI SDK는 설치하지 않는다.

| 제품 UI             | 선택한 구성                                                                                    | 상태·데이터 소유자                                  |
| ------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 일반 입력·날짜·확인 | Input, Field/Label, Select/Native Select, Calendar + Popover/Date Picker, Dialog, Alert Dialog | 해당 feature의 draft·검증·mutation                  |
| 메뉴·탐색·진행      | Dropdown Menu, Context Menu, Tabs, Tooltip, Pagination, Progress                               | URL·feature UI 상태·서버 진행 상태                  |
| AI 대화             | Chat 패턴, Message, Message Scroller, Bubble                                                   | editor-chat의 대화·스트림·오류·재시도               |
| 메시지 작성         | Prompt Input 패턴, Input Group, Attachment                                                     | editor-chat의 draft·첨부·IME-safe 전송·취소         |
| 근거 표시           | Sources, Inline Citation                                                                       | references/presentations의 실제 자료 ID·버전·페이지 |
| 실행 상태·확인      | Trace 기반 Tool, Plan, Task, Confirmation                                                      | Rust Workflow/inference의 실제 event·확인 상태      |

공식 [Chat](https://ui.shadcn.com/docs/ai-elements/base/chat)과 [Prompt Input의 Radix 예시](https://ui.shadcn.com/docs/ai-elements/radix/prompt-input)를 현재 Radix 계열에 맞게 도입한다. 기능마다 Base UI·Radix·React Aria를 섞지 않는다. 컴포넌트 소스는 Folio 토큰과 한국어 라벨에 맞춰 소유하며 필요한 registry 항목과 그 직접 의존성만 첫 소비자와 함께 추가한다. CLI는 개발 시 사용하는 도구이며 운영 시작에서 다운로드하거나 실행하지 않는다.

React/Vite를 유지하며 [공식 Vite 설치 경로](https://ui.shadcn.com/docs/installation/vite)를 사용한다. AI UI 도입 때문에 Next.js 서버, Vercel 배포, AI Gateway 또는 프론트엔드 Provider 연결을 추가하지 않는다. 모델 요청·비밀정보·도구 허용 목록·영속 Workflow는 Rust가 소유한다. AI Elements 화면 상태와 제품 API DTO 사이의 변환은 해당 feature가 담당한다.

`ai`, `@ai-sdk/react`, `@shadcn/helpers`는 현재 미설치다. [AI SDK helper](https://ui.shadcn.com/docs/helpers/ai-sdk)는 미리 정의한 대화를 모델·서버 없이 `useChat`으로 스트리밍하는 개발·데모·테스트 도구다. 실제 Provider 연결이나 운영 transport를 제공하는 패키지로 취급하지 않는다. 사용한다면 테스트 소비자와 함께 도입하고 제품 런타임에서 분리한다. 별도로 `ai`/`@ai-sdk/react`가 필요한 실제 AI 기능에서는 Rust 스트림 프로토콜·취소·재연결·버전 충돌 계약을 검토한다. 공용 스크롤 primitive 등 가져온 코드가 요구하는 패키지도 peer·번들 크기·라이선스를 확인하고 exact version으로 고정한다.

shadcn/ui 소스는 [MIT 라이선스](https://raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md)이며 가져온 코드의 고지를 유지한다. 이는 패턴에 딸린 모든 전이 의존성의 검토를 대신하지 않는다. 공식 소스 URL·가져온 버전/커밋·로컬 변경 범위는 도입 시 기록하며, 일반 Home 컴포넌트와 슬라이드 대화에 필요한 AI Elements 소스가 도입되었다.

## React HTTP·상태·훅 구성

| 책임                    | 설치된 패키지·고정 버전                           | 실제 소비자                                                            |
| ----------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| 화면·기본 훅            | React 19.3.1, React DOM 19.3.1                    | React 컴포넌트, useState/useReducer/useEffect 등                       |
| 서버 상태·캐시·mutation | TanStack Query 5.107.1                            | 프로젝트·Space 목록, 변경 후 무효화, Health                            |
| JSON HTTP               | Axios 1.21.1                                      | `shared/api/http.ts`: 프로젝트·Space·Health·업로드 취소 확인           |
| 공유 UI 상태            | Zustand 5.1.0                                     | `shared/work-panel-state.ts`: 작업 패널 표시 모드와 토스트 배치용 높이 |
| 탐색·URL 상태           | React Router 8.5.1                                | Home·Space 경로, 필터·페이지 상태                                      |
| 파일 전송               | Uppy Core 6.3.1, Uppy React 6.1.1, Uppy XHR 6.0.1 | 파일 큐·진행률·취소·재시도, useUppyState                               |
| 응답·입력 검증          | Zod 4.6.7                                         | API 응답 schema와 feature 입력 규칙                                    |
| 짧은 알림               | Sonner 2.0.8                                      | 공식 shadcn Sonner 기반 우측 하단 토스트                               |

Axios와 Zustand는 MIT이며 exact version으로 설치했다. Zustand의 React 18 이상 peer는 현재 React 19와 호환하며 선택적 Immer는 설치하지 않았다. use-sync-external-store는 기존 Uppy React의 전이 의존성과 같은 버전을 공유하며 별도 직접 의존성으로 추가하지 않았다. 두 패키지는 Vite 브라우저 번들에서 사용하고 운영 실행 시 다운로드하지 않는다. Axios의 Node 전용 전이 의존성은 브라우저 코드의 실행 경로가 아니다. 라이선스 고지는 설치 패키지에 유지한다. [Axios registry](https://registry.npmjs.org/axios/1.21.1), [Zustand registry](https://registry.npmjs.org/zustand/5.1.0)

공통 Axios 인스턴스는 기본 10초 timeout, Health 5초, 호출자의 AbortSignal, JSON 요청, 공개 API 오류 매핑과 Zod 성공 응답 검증을 소유한다. 재시도는 Query·해당 mutation의 기존 정책을 따르며 transport에서 자동 재전송하지 않는다. 쓰기 요청의 Idempotency-Key와 expected_version을 그대로 전달한다. 취소·네트워크 오류를 서버가 반환한 ApiError와 구분한다. [Axios 취소](https://axios-http.com/docs/cancellation)

Zustand는 탭 메모리의 UI 값만 저장한다. 작업 패널과 Sonner host는 필요한 필드만 selector로 구독한다. 업로드 파일·진행률은 Uppy, 확정 프로젝트·자산은 Query, 필터·페이지는 Router가 소유한다. persist·localStorage·탭 간 동기화는 사용하지 않으며 새로고침하면 UI 상태도 초기화한다. DOM ref·포커스·ResizeObserver의 수명은 컴포넌트에 남긴다. [Zustand create](https://zustand.docs.pmnd.rs/reference/apis/create)

### 재사용 훅 적용 범위

현재 설치된 React·TanStack Query·Zustand·Uppy의 훅을 사용한다. **추가 범용 훅 라이브러리는 도입하지 않는다.** usehooks-ts·ahooks는 미설치이며 도입 예정 목록에 포함하지 않는다. React Hook Form과 resolvers도 현재 미설치이며 이번 구성에 추가하지 않는다.

훅은 매 화면마다 새로 만들지 않는다. Query의 useQuery/useMutation, Uppy의 useUppyState, Zustand의 store 훅을 직접 재사용하고 제품 고유의 명령·리비전·수명 조합이 필요한 경우에만 feature 훅으로 묶는다. 단일 컴포넌트의 단순 입력·열림 상태는 useState/useReducer로 충분하다. 상태 공유와 로직 재사용은 서로 다른 요구사항이다. [React 커스텀 훅](https://react.dev/learn/reusing-logic-with-custom-hooks)

## React 검증 의존성

아래 패키지는 [frontend/package.json](../frontend/package.json)의 **devDependencies**에 설치되어 제품 화면 번들에서 사용하지 않는다.

| 패키지                        | 고정 버전 | 직접 소비                                      |
| ----------------------------- | --------- | ---------------------------------------------- |
| `@testing-library/react`      | 16.3.3    | React 렌더·해제·비동기 결과 검사               |
| `@testing-library/dom`        | 10.4.2    | 접근 가능한 역할·텍스트 조회, 명시적 peer 충족 |
| `@testing-library/user-event` | 14.6.10   | 사용자의 재시도 버튼 조작                      |
| `@testing-library/jest-dom`   | 7.0.1     | 상태·표시·비활성화 DOM assertion               |
| `jsdom`                       | 31.0.1    | Vitest의 DOM 실행 환경                         |

현재 Node 26.13.0과 React 19 환경에 맞춰 registry의 engines·peerDependencies를 확인했다. native canvas peer는 이 텍스트·폼 테스트의 소비 대상이 아니다.

[home-page.test.tsx](../frontend/src/pages/home-page.test.tsx)는 실제 Health 응답 파싱과 화면을 연결해 잘못된 응답·명시적 재시도·요청 취소를 검증한다. 테스트마다 QueryClient와 DOM을 해제한다. `passWithNoTests`는 제거했으며 테스트 없는 성공으로 품질 검증을 대신하지 않는다. [Testing Library API](https://testing-library.com/docs/react-testing-library/api/)

## 후속 기능의 미설치 검토 후보

아래는 조사한 **미설치 후보**다. 표의 버전은 조사 대상이며 lockfile에 설치되었다는 뜻이 아니다. 현재 설치 계획을 뜻하지 않는다. 후속 기능에서 필요성이 확정되면 peer·license·번들 비용·접근성을 검토한다. 범용 훅 묶음은 이 후보 범위에 포함하지 않는다. 쓰지 않는 import나 Knip 예외를 만들어 설치 상태만 유지하지 않는다.

| 기능          | 후보·조사 버전                           | 추가 조건·판단                                                                                |
| ------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| 복합 폼       | React Hook Form 7.92.0 + resolvers 7.0.6 | Provider·생성 폼 구현 시 기존 Zod와 연결; 단순 폼에는 native 상태 사용                        |
| 긴 목록       | TanStack Virtual 3.14.26                 | 실제 페이지·슬라이드 수와 렌더 비용을 측정한 뒤 적용                                          |
| PDF 뷰어      | React-PDF 11.1.0                         | PDF.js worker·WASM·폰트 동버전 로컬 번들, 오류·취소·브라우저 기준 확정                        |
| DnD           | `@dnd-kit/react` 0.5.3                   | React 슬라이드·목차 정렬 구현 시 pointer·keyboard·취소 검증; 다른 세대 API 패키지와 혼용 금지 |
| 리사이즈 패널 | react-resizable-panels 4.23.0            | 사용자 조절 가능한 workbench 구현 시; 접힘만 필요하면 native layout 유지                      |
| 리치텍스트    | Tiptap React/Core/PM 3.34.0              | text-run 모델·paste 정책·선택·undo 경계 확정 후 동일 패키지 버전 사용                         |
| HTTP 계약     | utoipa + openapi-typescript              | Space HTTP 계약 확장 시 검토; 아래 TypeScript 6 peer 불일치 해결 전 생성기 설치 보류          |
| 서버 PDF      | pdfium-render + PDFium 바이너리          | 패키지 ABI·플랫폼·프로세스 경계·폰트·무결성을 확정할 때                                       |
| 부하·SBOM     | Syft, Trivy 등                           | 릴리스 도구로 버전을 고정하고 별도 빌드 환경에서 사용                                         |

React-PDF는 React 19와 PDF.js worker 구성을 요구한다. worker와 PDF.js 본체는 같은 버전이어야 하며 CDN 런타임 조회를 사용하지 않는다. [React-PDF](https://github.com/wojtekmaj/react-pdf), [worker·브라우저 계약](https://github.com/wojtekmaj/react-pdf/wiki/Upgrade-guide-from-version-10.x-to-11.x)

프론트엔드 설치 패키지와 후보의 버전·peer·라이선스는 각 공식 registry manifest에서 확인했다: [Zustand](https://registry.npmjs.org/zustand/5.1.0), [React Hook Form](https://registry.npmjs.org/react-hook-form/7.92.0), [resolvers](https://registry.npmjs.org/@hookform/resolvers/7.0.6), [Virtual](https://registry.npmjs.org/@tanstack/react-virtual/3.14.26), [DnD](https://registry.npmjs.org/@dnd-kit/react/0.5.3), [Panels](https://registry.npmjs.org/react-resizable-panels/4.23.0), [Tiptap](https://registry.npmjs.org/@tiptap/react/3.34.0), [Sonner](https://registry.npmjs.org/sonner/2.0.8).

API 타입 생성은 런타임 검증·API 구현과 별개다. [openapi-typescript](https://openapi-ts.dev/introduction). Secret 저장에는 자체 암호 알고리즘을 만들지 않으며 AEAD를 사용하더라도 nonce·키 수명 규칙이 필요하다. [RustCrypto AEAD](https://docs.rs/chacha20poly1305/latest/chacha20poly1305/). PDFium 래퍼와 실제 라이브러리 바인딩은 별도 배포 대상이다. [pdfium-render](https://docs.rs/pdfium-render/latest/pdfium_render/)

## Space 확장: 로컬 오픈소스 우선 의존성 목록

**조사 기준일: 2026-11-15. 업로드·보관 목록은 현재 설치·연결되어 있으며 추출·미리보기 목록은 후속 후보다.** 공식 문서·registry manifest·upstream 라이선스와 peer/MSRV를 확인했다. Linux 배포 타깃에서의 빌드, 실제 팀 사용 구성의 전이 라이선스·취약점 검사와 파일 fixture 검증은 도입 시 수행한다. 기존 설치 패키지와 구분하며, 표의 버전은 조사 기준 버전이다.

범용 업로드 엔진, 파일 시그니처 DB, ZIP/CFB/XML 파서, 이미지 디코더, PDF 렌더러를 자체 작성하지 않는다. 유지되는 오픈소스에 맡기고 PuPuTyX는 허용 형식·용량·프로젝트/공용 범위·불변 버전·멱등성·commit·cleanup 정책과 좁은 adapter를 소유한다. 설치 개수를 늘리기 위해 같은 책임의 라이브러리를 중복 도입하지 않는다.

### 도입 결정

| 상태                        | 대상                                                                                      | 적용 방식                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Space 업로드에 설치·연결    | Uppy Core/React/XHR, file-format, zip, quick-xml, cfb, tempfile, sha2, cap-std, fs4       | 실제 원본 업로드·검사·저장과 연결. Linux 대상 운영 검증은 별도                                          |
| 처리 기능 구현 시 적극 활용 | Kordoc, LibreOffice, H2Orestart, PyMuPDF, PPT Master/python-pptx, image, React-PDF/PDF.js | 필요한 처리 경로에 포함. GPL/AGPL 때문에 사전 제외하지 않으며 PDF 엔진 간 동일 기능 중복은 비교 후 정리 |
| 요구 발생 시 추가           | tus, ClamAV, Tantivy, calamine, ammonia                                                   | 이어받기·회사 검사 정책·검색 성능·전용 추출·HTML 미리보기 등 실제 소비 기능을 기준으로 도입             |
| 구체적인 기술 문제로 보류   | openapi-typescript 7.13.0                                                                 | 현재 TypeScript 6과 peer 범위 불일치. 호환 버전 또는 검증된 대안이 정해지면 재개                        |

### 1. 실제 업로드·보관 기능의 우선 선정 목록

| 후보·조사 버전                                                      | 라이선스                                            | 역할·선정 이유                                                                   | 포함 방식·적용 조건                                                                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@uppy/core` 6.3.1 + `@uppy/react` 6.1.1 + `@uppy/xhr-upload` 6.0.1 | MIT                                                 | 파일 선택·드롭·큐·진행 이벤트·취소·재시도 엔진. 직접 XHR 큐를 만드는 대신 재사용 | Vite의 Space 청크에 번들. React hooks/headless 위에 shadcn UI 조합; 동일 출처 Axum multipart endpoint 사용                                       |
| `file-format` 0.29.0                                                | MIT OR Apache-2.0                                   | 파일 내용 기반 1차 형식 식별; 파일명/MIME 문자열만 신뢰하지 않음                 | Rust에 컴파일. 기본 signature 모드부터 적용; 모든 `reader` feature를 일괄 활성화하지 않음                                                        |
| `zip` 9.5.1                                                         | MIT                                                 | Office ZIP 검사·읽기, 공유 PPT 구성 파일의 결정적 다운로드 ZIP 조립              | Rust에 컴파일. `default-features=false`, 우선 `deflate-flate2-zlib-rs`; Stored/Deflate 범위로 시작, AES·다른 압축 알고리즘은 요구 발생 시만 추가 |
| `quick-xml` 0.42.0                                                  | MIT                                                 | OOXML Content Types의 스트리밍 XML 검사                                          | Rust에 컴파일. 문서 수·깊이·텍스트 한도는 adapter 정책. encoding 지원은 실제 UTF-16 fixture와 공식 decoding reader를 검증한 뒤 추가              |
| `cfb` 0.16.0                                                        | MIT                                                 | HWP 5.x와 OLE 컨테이너의 디렉터리·stream 검사                                    | Rust에 컴파일. `FileHeader` 등 형식별 식별 정책과 암호화/미지원 형식 상태는 별도. 전체 HWP 본문 파서는 Kordoc에 위임                             |
| `tempfile` 3.27.0                                                   | MIT OR Apache-2.0                                   | 충돌 없는 임시 파일 생성·수명 관리                                               | runtime과 dev dependency에 연결; `new_in`으로 Blob과 같은 파일시스템의 staging 사용                                                              |
| `cap-std` 4.0.3                                                     | MIT OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception | 디렉터리 capability 기준 상대 파일 접근, 자체 문자열 prefix 검사 최소화          | filesystem adapter에 컴파일. 동기 API는 제한된 blocking 경계에서 사용; 자식 프로세스 sandbox를 제공하는 것은 아님                                |
| `fs4` 1.1.0                                                         | MIT OR Apache-2.0                                   | 저장소 여유 공간 조회·필요한 사전 할당                                           | filesystem adapter에 컴파일. 현재 표준 라이브러리 인스턴스 잠금을 대체하려고 추가하지 않음; 현재 용량 admission에서 사용                         |
| `sha2` 0.11.1                                                       | MIT OR Apache-2.0                                   | 스트리밍 SHA-256, 원본 바이트 중복 제거                                          | 실제 Blob 저장 기능에서 사용                                                                                                                     |

Uppy의 [React 통합](https://uppy.io/docs/react/)은 hooks/headless 구성을 제공한다. [XHR uploader](https://uppy.io/docs/xhr-upload/)는 일반 HTTP 서버를 대상으로 하므로 Transloadit 서비스·Companion·S3가 필수는 아니다. `@uppy/react` 6.1.1의 Dashboard/Webcam/Status Bar/Screen Capture peer는 optional이며 제품에서는 해당 UI/원격 소스를 구성하지 않는다. lockfile의 optional peer 전이 항목과 실제 번들 소비를 구분한다. 원격 파일 소스·Golden Retriever 등 브라우저 영속 저장 plugin도 기본 구성에서 제외한다. 의존성과 peer의 근거는 [Core manifest](https://registry.npmjs.org/@uppy/core/6.3.1), [React manifest](https://registry.npmjs.org/@uppy/react/6.1.1), [XHR manifest](https://registry.npmjs.org/@uppy/xhr-upload/6.0.1), [MIT 고지](https://github.com/transloadit/uppy/blob/main/LICENSE)다.

Uppy가 소유하는 전송 큐를 Zustand나 Query에 복제하지 않는다. Query는 서버 확정 자산, 폼은 작성 중 메타데이터, Uppy는 파일/전송 상태를 맡는다. 업로드 instance의 route-independent 수명과 destroy/abort는 앱의 upload owner가 관리한다. 파일별 재시도 키는 API 멱등성 계약과 연결한다. **전송 100%는 서버 등록 완료가 아니며**, 저장 확정·추출·색인은 별도 상태다. XHR 재시도를 바이트 단위 이어받기로 표시하지 않는다.

서버 후보의 버전·license·feature/MSRV 원본은 crates.io manifest다: [file-format](https://crates.io/api/v1/crates/file-format/0.29.0), [zip](https://crates.io/api/v1/crates/zip/9.5.1), [quick-xml](https://crates.io/api/v1/crates/quick-xml/0.42.0), [cfb](https://crates.io/api/v1/crates/cfb/0.16.0), [tempfile](https://crates.io/api/v1/crates/tempfile/3.27.0), [cap-std](https://crates.io/api/v1/crates/cap-std/4.0.3), [fs4](https://crates.io/api/v1/crates/fs4/1.1.0). 명시된 MSRV는 현재 Rust 1.99 이하이며 cap-std는 해당 manifest에 MSRV가 없어 빌드 검증을 별도로 남긴다.

### 2. 검사 라이브러리와 제품 정책의 경계

- [file-format](https://docs.rs/file-format/0.29.0/file_format/)의 식별 결과는 판정 근거이며 안전성 인증이 아니다. 원본 이름·클라이언트 MIME·실제 signature·컨테이너 구조를 비교한다. `mime_guess`는 응답 MIME 보조로 유지하고 업로드 검증기로 사용하지 않는다. `infer` 0.22.0(MIT)은 비교 후보지만 file-format과 함께 같은 검사를 중복 수행하도록 설치하지 않는다.
- [zip](https://docs.rs/zip/latest/zip/read/struct.ZipArchive.html)에 파싱/해제를 맡긴다. 항목 수·선언 크기·실제 읽은 해제 바이트·압축률·중첩 깊이·시간을 제한하고 암호화·중복/겹침 항목·경로 탈출·심볼릭 링크를 정책적으로 처리한다. archive 전체를 임의 경로에 풀지 않는다. 라이브러리 API나 ZIP 헤더 크기만으로 ZIP bomb 방어 완료를 주장하지 않는다.
- [quick-xml](https://docs.rs/quick-xml/0.42.0/quick_xml/)을 이용해 XML event를 읽고, 외부 리소스 조회 없이 허용된 구성만 해석한다. DTD·외부 관계·macro/embedded payload 처리와 namespace/content-type 일관성은 검사 프로필에 명시한다. 지원하지 않는 encoding은 무시하지 않고 명확히 실패시킨다.
- [tempfile](https://docs.rs/tempfile/3.27.0/tempfile/struct.NamedTempFile.html)의 임시 파일·persist API와 [cap-std](https://docs.rs/cap-std/latest/cap_std/fs/struct.Dir.html)의 파일 접근을 재사용한다. 파일/디렉터리 fsync, OS별 원자 게시, Blob 중복 경쟁, DB commit 실패와 고아 Blob 회수는 여전히 제품의 책임이다. 프로세스 강제 종료는 정상 Drop cleanup과 구분한다.
- [fs4](https://docs.rs/fs4/latest/fs4/)의 여유 공간 수치는 순간 관측값이다. 동시 업로드의 예약량·한도·실제 write 실패 처리는 별도로 유지한다. 파서의 동기/CPU 작업은 HTTP 이벤트 루프·DB writer에서 장시간 실행하지 않는다.

### 3. 추출·미리보기·계약 단계의 추가 후보

| 후보·조사 버전                                   | 라이선스                                | 사용 시점·포함 방식                                                                   | 선택 조건                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image` 0.25.10                                  | MIT OR Apache-2.0                       | 실제 이미지 미리보기; Rust 내장                                                       | `default-features=false` + 필요한 PNG/JPEG/WebP codec. 치수·픽셀·메모리 한도를 검증; [Limits](https://docs.rs/image/0.25.10/image/struct.Limits.html)의 codec별 보장 차이를 고려                                                                              |
| React-PDF 11.1.0 + `pdfjs-dist` 6.5.438          | MIT / Apache-2.0                        | 브라우저 PDF 미리보기; Space에서 lazy load                                            | React-PDF가 고정한 PDF.js 버전과 worker·CMap·폰트·WASM을 같은 빌드에 포함. CDN 조회 없음. [manifest](https://registry.npmjs.org/react-pdf/11.1.0)                                                                                                             |
| `pdfium-render` 0.9.5 + PDFium ABI 일치 바이너리 | MIT OR Apache-2.0 / PDFium 및 전이 고지 | 서버 PDF 페이지 렌더링; Rust wrapper + `runtime/pdfium/`                              | native PDFium 파일은 별도 공급·체크섬 검증. 플랫폼/ABI/폰트·스레드 사용을 검증하고 필요 없는 V8/XFA 기능 제외. [wrapper](https://docs.rs/pdfium-render/0.9.5/pdfium_render/), [PDFium 고지](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/LICENSE) |
| PyMuPDF (PPT Master와 함께 버전 고정)            | AGPL-3.0 / 별도 상용 옵션               | PDF 텍스트·이미지·메타데이터·렌더링, PPT Master의 PDF→Markdown; Python runtime에 포함 | 사내 사용 후보에 포함. 실제 사용 조건 확인 후 우리 PDF fixture로 Kordoc/PDFium과 비교; 같은 기능의 엔진을 무조건 중복 설치하지 않음. [공식 문서](https://pymupdf.readthedocs.io/en/latest/about.html)                                                         |
| `lopdf` 0.47.0                                   | MIT                                     | PDF 메타데이터·구조 검사에 별도 소비자가 있을 때; Rust 내장                           | PDFium/Kordoc과 책임을 중복시키지 않음. 렌더러나 OCR 엔진으로 취급하지 않음. [manifest](https://crates.io/api/v1/crates/lopdf/0.47.0)                                                                                                                         |
| `calamine` 0.38.0                                | MIT                                     | XLSX cell/sheet 구조가 Kordoc 결과 외에 직접 필요할 때; Rust 내장                     | 동일 추출 결과를 두 엔진이 각각 정본으로 저장하지 않음. [upstream](https://github.com/tafia/calamine)                                                                                                                                                         |
| `python-pptx`                                    | MIT                                     | PPTX shape·image·chart·layout 접근; PPT Master용 Python 번들                          | PPT Master가 사용하는 버전으로 함께 고정. 객체 읽기/편집과 실제 Office 렌더링·전체 객체 왕복 보장은 구분. [upstream](https://github.com/scanny/python-pptx)                                                                                                   |
| `utoipa` 6.0.0                                   | MIT OR Apache-2.0                       | Space multipart/오류/버전 API의 OpenAPI 생성; Rust 내장                               | `macros`, `axum_extras`, 필요한 `uuid`만 도입. `schemars/jsonschema`는 Tool/Artifact schema, utoipa는 HTTP 계약을 맡음. [manifest](https://crates.io/api/v1/crates/utoipa/6.0.0)                                                                              |
| `openapi-typescript` 7.13.0                      | MIT                                     | OpenAPI→TS 타입 생성; 개발 도구                                                       | **현재 보류:** 공식 manifest의 TypeScript peer가 `^5.x`, 프로젝트는 6.0.3. 호환 버전 확인 전 peer 검사 우회·TS downgrade 없음. [manifest](https://registry.npmjs.org/openapi-typescript/7.13.0)                                                               |
| `@uppy/tus` 6.0.1                                | MIT                                     | 실제 중단 후 바이트 이어받기가 요구될 때; 브라우저 번들                               | tus 서버 프로토콜·영속 업로드 세션이 함께 구현돼야 함. 현재 multipart 위에 plugin만 추가하지 않음. [공식 uploader](https://uppy.io/docs/tus/)                                                                                                                 |

키워드 검색은 현재 번들 SQLite FTS5부터 사용한다. `tantivy` 0.27.0(MIT)은 FTS5의 검색 품질/성능 한계가 측정된 경우의 로컬 검색 후보이며 별도 인덱스 비용·재구축·한국어 tokenizer를 검증한다. HTML 미리보기가 실제로 필요하면 `ammonia` 4.2.5(MIT OR Apache-2.0)를 Rust sanitize 후보로 검토한다. 기본은 안전한 텍스트·이미지/PDF 미리보기이며 원문 HTML이나 LLM 생성 HTML을 그대로 실행하지 않는다. [Tantivy](https://github.com/quickwit-oss/tantivy), [Ammonia](https://github.com/rust-ammonia/ammonia)

### 4. 로컬 실행 도구의 upstream과 번들 후보

| 도구             | 확인한 upstream·라이선스                                                                                                                                   | 제품 역할                                       | 팀 서버 적용에 남은 조건                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Kordoc           | [chrisryugj/kordoc](https://github.com/chrisryugj/kordoc), npm 조사 버전 4.24.80, MIT                                                                      | 문서 구조·텍스트·표·이미지/OCR 추출             | 고정 CLI + Node + optional native dependencies + 선택 모델을 `runtime/kordoc/`에 포함; 실제 파일 fixture/OS·CPU 검증 필요         |
| LibreOffice      | [공식 배포](https://www.libreoffice.org/), [MPL-2.0 및 배포별 전이 고지](https://www.libreoffice.org/licenses/)                                            | Office→PDF 정규화                               | Linux 대상 바이너리/라이브러리/폰트 고정, 데이터 경로의 독립 사용자 profile, timeout·프로세스 종료 검증                           |
| H2Orestart       | [ebandal/H2Orestart](https://github.com/ebandal/H2Orestart), [GPLv3](https://github.com/ebandal/H2Orestart/blob/main/COPYING)                              | LibreOffice의 HWP/HWPX 읽기 확장                | 확장 `.oxt` + 맞는 LibreOffice/Java 조합 검증; 팀 내부 사용 후보로 채택; 실제 확장 수정·설치 형태의 고지/소스 관리 조건 확인      |
| PPT Master       | [hugohe3/ppt-master](https://github.com/hugohe3/ppt-master), MIT                                                                                           | 템플릿 등록/분석·선택한 PPTX 생성 스크립트      | tag/commit과 Python 의존성 고정, 호출할 스크립트 allowlist·입출력 schema·font/renderer 검증. SaaS 대체가 아닌 로컬 script adapter |
| Python/Node/Java | 선택 엔진이 지원하는 공식 runtime 배포                                                                                                                     | 외부 도구 실행                                  | 제품 Node 개발 버전을 무조건 runtime으로 복사하지 않음. 선택 binary의 OS/CPU·동적 라이브러리·license를 별도 manifest로 관리       |
| ClamAV           | [공식 설치/소스 빌드](https://docs.clamav.net/manual/Installing.html), [GPLv2 고지](https://raw.githubusercontent.com/Cisco-Talos/clamav/main/COPYING.txt) | 회사 정책상 필요한 경우 로컬 파일 악성코드 검사 | 선택 사항. 엔진·서명 DB·업데이트 절차·메모리 비용 검증 후 포함; 외부 파일 업로드 서비스로 대체하지 않음                           |

Kordoc의 [오프라인 가이드](https://github.com/chrisryugj/kordoc/blob/main/docs/offline-deployment.md)는 대상 OS/CPU에서 빌드한 번들을 전제로 한다. `--with-ocr --with-models`가 선택 가능한 모델 전부를 포함한다는 가정은 금지한다. 가이드에는 별도 server/medium detector·handwriting recognizer가 명시돼 있다. 허용 OCR 프로필의 모든 모델·사전·native module을 사전에 확보하거나 미포함 기능을 비활성화한다. 실행에는 `KORDOC_OFFLINE=1`을 적용하고 모델 캐시도 앱 저장소로 명시한다. `KORDOC_ROOT`는 upstream의 MCP 파일 접근 범위 설정이며 CLI 자식 프로세스의 OS 격리를 대신하지 않는다. CLI 입력 경로·작업 공간·자원 제한은 별도로 통제한다. upstream 문서의 성공/보안 주장을 PuPuTyX의 검증 완료로 대신하지 않는다.

PPT Master의 [실제 Python 요구사항](https://github.com/hugohe3/ppt-master/blob/main/skills/ppt-master/requirements.txt)은 선택 기능 전체 목록이다. PDF→Markdown용 **PyMuPDF는 AGPL-3.0이며 이번 팀 내부 사용의 유효한 후보에 포함한다.** 상업용 고객 재배포를 가정해 제외하지 않는다. [PyMuPDF 공식 안내](https://pymupdf.readthedocs.io/en/latest/about.html)에 따른 실제 결합·수정·서버 사용 조건을 확인하고, 필요한 PPT Master 경로가 이를 소비하면 같은 Python 환경에 번들한다.

PDFium·Kordoc·PyMuPDF 중 어떤 엔진을 사용할지는 우리 문서 fixture의 추출 품질·속도·메모리·설치 복잡도로 결정한다. 하나로 충분하면 동일 기능을 수행하는 파서를 모두 넣지 않는다. `edge-tts` 같은 외부 통신 기능이나 사용하지 않는 변환·음성 기능은 기능 필요성과 로컬 실행 조건에 따라 제외한다. 필요한 script closure만 offline wheelhouse로 고정하며 앱 시작에서 전체 requirements를 설치하지 않는다.

### 5. 팀 내부 배포와 중복 구현 방지

- Uppy를 채택하면 업로드 queue/retry 엔진을 별도로 구현하거나 react-dropzone·dnd-kit·별도 Axios 업로드 transport를 동시에 추가하지 않는다. JSON API 통신은 공통 Axios transport를 사용한다. react-dropzone 20.2.0(MIT)은 단순 파일 선택만 필요한 대안이고 업로드 엔진은 아니다.
- 파일 시그니처 테이블·ZIP inflater·CFB sector reader·XML tokenizer·PDF renderer를 PuPuTyX에서 재작성하지 않는다. 다만 라이브러리가 제공하지 않는 제품 허용 정책과 실패 복구를 생략하지 않는다.
- Cargo 라이브러리는 Rust 빌드에, 브라우저 패키지는 Vite 자산에, 외부 프로그램은 `runtime/`과 `licenses/`에 포함한다. 캐시·작업 파일만 앱의 `./data/` 또는 명시적으로 구성한 저장소에 둔다.
- 릴리스 manifest에는 이름·정확한 버전/tag/commit·원본 URL·SHA-256·OS/CPU/ABI·license/notice·모델/폰트·실행 entry point를 기록한다. 빌드 시 필요한 다운로드와 앱 실행 시 다운로드를 구분한다.
- 실제 팀 서버의 대상 Linux 환경에서 번들만으로 실행 가능한지 확인하고, 외부 네트워크 차단 상태에서 업로드·미리보기·추출을 검증한다. 외부 LLM은 원래 제품 계약의 명시적인 Provider 경로로만 허용한다.
- 검증에는 위장 확장자, 손상/암호화 ZIP·CFB·PDF, 해제 한도, XML encoding/외부 관계, 취소·재시작·디스크 부족, 같은 Blob 동시 등록, 누락 모델, 라이선스 고지를 포함한다. 현재 이 목록은 **계획된 수용 조건**이다.

## 선택하지 않은 구성

- SQLite 접근 계층은 rusqlite로 통일한다. SQLx·Diesel·SeaORM과 이중 연결·Migration 체계를 도입하지 않는다.
- 현재 규모에서 별도 Redis·메시지 브로커·벡터 DB를 필수화하지 않는다. FTS5와 SQLite 영속 작업에서 시작한다.
- Provider별 SDK로 비즈니스 로직을 결합하지 않는다. reqwest 기반 protocol adapter와 공통 inference 계약을 사용한다.
- 범용 agent framework·전역 event bus·plugin container는 현재 use case에 필요한 의존성이 아니다.
- PDF·이미지·리치텍스트 전체를 앱 초기 번들에 넣지 않는다. 기능별 lazy import와 자산 경로가 정해진 뒤 도입한다.
- Kordoc·PPT Master·H2Orestart는 위에서 확인한 upstream을 후보로 사용한다. 실제 릴리스/tag·전이 라이선스·대상 플랫폼 번들 검증 전에는 배포 완료로 표시하지 않는다. 이름이 비슷한 registry 패키지를 임의 설치하지 않는다.

## 재현·검사

```sh
./scripts/setup.sh
pnpm check
pnpm build
./scripts/smoke-test.sh --no-build
```

`setup.sh`는 `pnpm install --frozen-lockfile`, `cargo fetch --locked`, `pnpm tools:install`을 실행한다. 네이티브 SQLite·TLS 구성에는 플랫폼별 C 빌드 도구가 필요하며, 런타임 도구 설치를 앱 시작 과정에 추가하지 않는다.

직접 추가한 패키지의 registry 라이선스는 MIT 또는 MIT/Apache 계열이며 jsdom·Testing Library는 MIT다. 이는 전체 릴리스의 제3자 고지·전이 의존성·모델·폰트 검토 완료를 뜻하지 않는다. `pnpm audit`는 npm advisory 범위의 검사이며 Rust·네이티브 도구의 취약점 검사를 대체하지 않는다.

새 버전 도입 시 manifest·lockfile·feature·MSRV/Node·peer 범위·원본 라이선스를 함께 검토한다. DB driver 단일성, schema 외부 조회 차단, Provider stream 분할, React 오류·취소 테스트가 통과해야 기본 구성에 반영한다.

## Node 품질 도구와 React 성능 분석

| 도구                         | 설치·적용                               | 책임                                                |
| ---------------------------- | --------------------------------------- | --------------------------------------------------- |
| Biome 2.6.7                  | 루트 devDependency                      | JS·TS·JSX·TSX·JSON·CSS 포맷, React·Node 코드 lint   |
| TypeScript                   | 프론트엔드 devDependency                | 타입 검사                                           |
| Knip                         | 프론트엔드 devDependency                | 미사용 파일·export·의존성 탐지                      |
| Vitest·Testing Library·jsdom | 프론트엔드 devDependency                | 동작·실패·취소 테스트                               |
| Prettier                     | 루트 devDependency, 문서·HTML·YAML 범위 | 코드와 겹치지 않는 마크업 포맷                      |
| React Developer Tools        | 개발자 브라우저 확장                    | Components·Profiler에서 컴포넌트와 렌더링 비용 분석 |
| rustfmt·Clippy               | Rust 도구 체인                          | Rust 포맷·정적 분석                                 |

[biome.json](../biome.json)이 코드 포맷·검사 범위의 원본이다. React Hooks, 접근성, 타입 import/export를 검사하며 오류와 warning을 품질 실패로 처리한다. Biome은 TypeScript 타입 검사나 실제 브라우저 접근성 시험을 대체하지 않는다. 제품 CSS의 의미 검사와 목업 JavaScript의 동작 검증은 전용 검사·브라우저 테스트를 유지한다.

문서·HTML·YAML은 Prettier, 나머지 지원 코드는 Biome이 맡는다. `.prettierignore`로 두 도구의 코드 포맷 범위를 분리한다. 디자인 토큰 생성기도 고정된 로컬 Biome CLI로 결과를 포맷한다. Git 연동은 비활성화되어 있으며 lint 실행을 위해 Git 저장소가 필요하지 않다. [Biome 설정](https://biomejs.dev/reference/configuration/)

ESLint 및 관련 플러그인·typescript-eslint와 해당 minimatch override는 사용하지 않는다. minimatch 자체는 UI 검사 도구가 아닌 다른 도구가 사용할 수 있는 경로 패턴 라이브러리다. 전이 의존성이 남는지는 lockfile과 `pnpm why -r minimatch`로 확인한다.

### React Developer Tools

웹앱 개발은 React 공식 문서의 브라우저 확장 방식을 사용한다. npm 독립 앱이나 앱 내 디버그 스크립트를 제품 의존성에 추가하지 않는다. 공식 도구이지만 설치 위치는 프로젝트 `devDependencies`가 아닌 브라우저다. 확장 설치는 개발자 브라우저에서 별도로 수행한다. [React 공식 안내](https://react.dev/learn/react-developer-tools)

React Compiler는 개발 시 코드를 변환하는 공식 자동 최적화 도구이며 DevTools의 성능 측정과 역할이 다르다. React Scan은 별도의 비공식 성능 시각화 도구다. [React Compiler](https://react.dev/learn/react-compiler/installation), [React Scan](https://github.com/aidenybai/react-scan)

### React Compiler 구성

| 패키지                        | 고정 버전 | 위치·역할                                            |
| ----------------------------- | --------- | ---------------------------------------------------- |
| `babel-plugin-react-compiler` | 1.0.0     | 프론트엔드 devDependency, React 최적화 변환          |
| `@rolldown/plugin-babel`      | 0.3.1     | 프론트엔드 devDependency, Vite 8의 Babel 변환 연결   |
| `@babel/core`                 | 7.29.13   | 프론트엔드 devDependency, plugin-babel의 명시적 peer |

[frontend/vite.config.ts](../frontend/vite.config.ts)에서 `react()` 뒤에 `babel({ presets: [reactCompilerPreset({ target: '19' })] })`를 등록한다. Vite React 플러그인 6의 공식 preset이 React 변환 전에 compiler를 실행하고 필요한 runtime을 의존성 최적화에 연결한다. React 19가 제공하는 `react/compiler-runtime`을 사용하므로 별도 `react-compiler-runtime` 패키지는 추가하지 않는다.

개발 서버와 제품 빌드 모두 이 구성을 사용한다. `mock/`는 독립적인 vanilla JavaScript이며 변환 대상이 아니다. 컴파일 대상 추론·실패 처리에는 공식 기본값을 사용하고 모든 함수를 강제 컴파일하지 않는다. Biome lint와 TypeScript 검사도 계속 수행한다. [공식 Vite 설치](https://react.dev/learn/react-compiler/installation), [Compiler 설정](https://react.dev/reference/react-compiler/configuration)

Vitest는 별도 설정에서 소스 동작을 검증한다. 컴파일러 적용은 Vite의 실제 모듈 변환과 빌드를 통해 확인하고, 포함된 UI의 실행은 릴리스 smoke와 브라우저 검사로 검증한다. 빌드 성공이나 cache 생성만으로 렌더링 시간 개선을 주장하지 않으며, 실제 개선은 동일 입력·환경에서 Profiler로 측정한다.

## Rust CLI 도구와 커버리지

CLI 도구의 고정 버전 원본은 [scripts/dev-tools.json](../scripts/dev-tools.json)이다. Cargo의 제품 `dependencies`나 `dev-dependencies`에 넣지 않고 개발자 도구로 설치한다.

| 도구                | 고정 버전 | 프로젝트 명령·역할                                |
| ------------------- | --------- | ------------------------------------------------- |
| cargo-machete       | 0.9.2     | `pnpm check:deps`, 미사용 직접 의존성             |
| cargo-deny          | 0.20.2    | `pnpm check:deps`, 취약점·라이선스·출처·중복 버전 |
| cargo-nextest       | 0.9.151   | `pnpm test:rust`, 일반 Rust 테스트 실행           |
| cargo-llvm-cov      | 0.9.1     | `pnpm coverage:rust`, LLVM 기반 소스 커버리지     |
| @vitest/coverage-v8 | 5.1.0     | frontend devDependency, `pnpm coverage:frontend`  |

`pnpm tools:install`은 rustup의 고정 Rust toolchain과 LLVM 구성요소를 준비하고 필요한 버전의 CLI를 설치한다. `pnpm tools:check`는 버전과 도구 존재를 검증한다. 실제 앱 시작에서는 설치를 수행하지 않는다.

Rust 커버리지는 Homebrew 등 다른 Rust 배포본과 LLVM 도구가 섞이지 않도록 `rustup run`으로 프로젝트 toolchain을 사용한다. 코드 커버리지 계측은 실행 비용이 있으므로 일반 테스트와 별도 명령으로 제공한다. nextest가 실행하지 않는 doctest는 `cargo test --doc`로 이어서 검사한다.

[deny.toml](../deny.toml)은 workspace의 모든 feature와 개발·빌드 의존성을 검사한다. 지정한 라이선스 목록으로 판단하고 출처 불명의 registry·Git 의존성 및 yanked crate는 실패시킨다. 비공개 `publish = false` 제품 패키지는 제3자 라이선스 검사에서 제외한다. 알려진 취약점 예외 목록은 비어 있다. 중복 전이 버전은 warning으로 표시하며 숨기지 않는다.

이 검사는 사용한 Rust 패키지의 정책 검사이며 Office·OCR 바이너리·모델·폰트의 전체 배포 검토를 대체하지 않는다. 네트워크 접근이 필요한 advisory·npm audit는 앱의 무다운로드 실행 계약과 별개의 개발 검사다. [cargo-deny](https://embarkstudios.github.io/cargo-deny/), [cargo-machete](https://github.com/bnjbvr/cargo-machete), [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov), [Vitest coverage](https://vitest.dev/guide/coverage.html)

## 현재 Space에 설치·연결한 추가 구성

위 업로드 목록의 Uppy, file-format, zip, quick-xml, cfb, tempfile, cap-std, fs4, sha2는 실제 제품 소비자가 연결되어 있다. `hex 0.4.3`은 SHA-256 경로 인코딩, `percent-encoding 2.3.2`는 UTF-8 다운로드 파일명, `lopdf 0.47.0`(MIT, defaults off)은 PDF 파싱·암호화/페이지 제한에 사용한다. lopdf를 PDF 렌더러나 OCR로 사용하지 않는다. `@radix-ui/react-tabs 1.2.1`, `@radix-ui/react-progress 1.2.1`은 공식 shadcn Tabs/Progress의 소비 의존성이다. 레지스트리 원본·해시는 [components.sources.json](../frontend/components.sources.json)에 기록했다.

`cap-std`의 Windows 전이 의존성 `winx 0.36.4`의 Apache-2.0 WITH LLVM-exception 고지를 검토해 [deny.toml](../deny.toml)의 허용 SPDX 표현식에 추가했다. 기존 취약점 검사·알 수 없는 출처 차단은 유지한다. 현재 검증 플랫폼은 macOS이며 이 허용은 Windows 제품 동작 검증을 뜻하지 않는다.

### 비동기 SQLite와 작업 큐

| 라이브러리                            | 판단                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `async-sqlite 0.7.0`                  | 채택. rusqlite 0.41과 호환, MIT. Client가 단일 SQLite 연결/스레드와 유한 큐를 관리하고 결과를 await한다. 별도 ORM·Migration은 추가하지 않는다.                      |
| `tokio-rusqlite 0.9.0`                | 유사한 thread bridge. 해당 버전의 rusqlite 0.42 요구가 현재 0.41과 달라 함께 설치하지 않는다.                                                                       |
| `deadpool-sqlite 0.14.0`              | rusqlite 0.40 기반 pool. 현재 한 연결의 짧은 트랜잭션에는 추가 pool이 필요하지 않다.                                                                                |
| Apalis core 1.2 / `apalis-sqlite 1.1` | apalis-core 1.2.0 채택: CustomBackend가 기존 async-sqlite 기반 영속 작업 저장소를 사용한다. apalis-sqlite는 SQLx의 native SQLite links 충돌 때문에 설치하지 않는다. |

[async-sqlite 공식 문서](https://docs.rs/async-sqlite/latest/async_sqlite/), [tokio-rusqlite](https://docs.rs/tokio-rusqlite/latest/tokio_rusqlite/), [deadpool-sqlite](https://docs.rs/deadpool-sqlite/latest/deadpool_sqlite/), [Apalis SQLite manifest](https://crates.io/api/v1/crates/apalis-sqlite/1.1.0/dependencies).

Python의 aiosqlite와 같은 방향으로 동기 DB를 전용 스레드에 격리한다. SQLite 쓰기 자체가 병렬화되는 것은 아니다. 현재 앱의 admission은 실행·대기 합계 64개, library queue capacity는 65다. 호출 취소 전에 시작하지 않은 작업은 라이브러리가 생략할 수 있고 이미 시작한 변경은 확정될 수 있으므로 멱등성과 CAS를 유지한다. 현재 업로드의 Tokio semaphore/취소 token/등록 receipt는 전체 Durable DAG·OCR job queue 구현이 아니다.

## HTML 원본 검사

[`html5ever 0.40.1`](https://docs.rs/html5ever/0.40.1/html5ever/)을 workspace/backend에 exact version으로 설치했다. [Servo upstream](https://github.com/servo/html5ever)의 MIT OR Apache-2.0 파서이며 MSRV 1.85로 현재 Rust 1.99와 호환된다. `adapters/formats/html.rs`가 tokenizer를 소비한다. DOM 트리를 만들지 않고 UTF-8 입력을 제한된 조각으로 공급해 markup·복잡도·취소를 검사한다. 네트워크·JavaScript 실행·sanitize·렌더링 기능으로 사용하지 않는다. 별도 parser/브라우저 런타임이나 아직 소비하지 않는 ammonia를 추가하지 않는다.

알림함의 행 구성은 공식 [shadcn Item](https://ui.shadcn.com/docs/components/radix/item) 소스를 사용한다. 사용하지 않는 group/separator/header/footer export는 제외하고 기존 Slot·class-variance-authority를 재사용해 새 runtime 패키지를 추가하지 않았다. 원본 URL·SHA-256은 components.sources.json에 기록한다. [Sonner](https://ui.shadcn.com/docs/components/radix/sonner)는 일시적 토스트용이며 현재 우측 하단 전역 알림에 설치·연결되어 있다.

`sonner 2.0.8`과 `@radix-ui/react-collapsible 1.2.1`은 MIT이며 React 19 peer 범위를 확인해 exact version으로 설치했다. 공식 shadcn Sonner 소스의 next-themes는 light-only 정책에 따라 제외하고 theme=light로 고정한다. Collapsible은 작업 패널 펼침 상태·ARIA를 맡고 파일 전송은 기존 Uppy가 계속 소유한다.

## Provider 프로토콜 공급원

Provider별 Rust 어댑터는 기존 reqwest·serde_json·jsonschema를 재사용한다. reqwest의 query feature를 활성화해 pagination cursor를 URL 인코딩한다. 신규 Provider SDK나 범용 React 훅은 추가하지 않는다. 프로토콜별 계약과 현재 검증 범위는 [API 문서](04-data-api.md#네이티브-provider-계약)를 따른다.

- [OpenAI Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses): Responses endpoint, text.format, store=false.
- [Claude API](https://platform.claude.com/docs/en/api/overview), [버전](https://platform.claude.com/docs/en/api/versioning), [구조화 출력](https://platform.claude.com/docs/en/build-with-claude/structured-outputs): Bearer, 2026-10-21, output_config.format.
- [Gemini generateContent](https://aistudio.google.com/api-reference/generate-content): systemInstruction, generationConfig.responseJsonSchema, parts 및 usageMetadata.
- [LM Studio Native Chat](https://lmstudio.ai/docs/developer/rest/chat), [Models](https://lmstudio.ai/docs/developer/rest/list): native input/output, store=false, integrations 비활성화.
- [llama.cpp Server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md): apply-template, completion, json_schema.
- [SGLang Native](https://docs.sglang.io/docs/basic_usage/native_api), [tokenization source](https://github.com/sgl-project/sglang/blob/main/python/sglang/srt/entrypoints/openai/serving_tokenize.py): model_path 확인, 서버 template tokenization, generate.
- [vLLM](https://docs.vllm.ai/en/latest/serving/openai_compatible_server/), [LiteLLM](https://docs.litellm.ai/docs/proxy/user_keys): 공식 OpenAI 호환 인터페이스.

## System One / Decisions API 지원 조사

공식 문서·소스 확인일: 2026-11-15. 아래는 API 계약 확인과 PuPuTyX adapter 구현 범위다. 외부 계정·현재 설치 서버의 실제 호출 성공이나 해당 모델의 정확도를 의미하지 않는다. 새 SDK/런타임 패키지 없이 기존 reqwest·serde·JSON Schema·암호화 의존성을 사용한다.

| Provider         | 공식 판정 API                    | PuPuTyX 연결 및 조건                                                                                                     | 근거                                                                                                                                                                                                                        |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeSafe Jev     | `/v1/systemone`                  | typesafe; Bearer, 모델 목록/choice 평가                                                                                  | [공식 API](https://docs.typesafe.ai/api/system-one)                                                                                                                                                                         |
| OpenAI           | `/v1/decisions`                  | openai_decision; input·questions 배열/choices로 변환, gpt-6-luna                                                         | [Decisions](https://developers.openai.com/api/docs/guides/decisions)                                                                                                                                                        |
| Gemini           | `/v1beta/decisions`              | gemini_decision; input·questions map, x-goog-api-key, gemini-decision-1, Beta                                            | [Create decision](https://aistudio.google.com/api-reference/decisions/create-decision), [API models](https://ai.google.dev/api/decisions)                                                                                   |
| Claude           | 전용 API 미확인                  | LLM Messages/구조화 출력 bridge만 제공; 전용 native 연결은 추가하지 않음                                                 | [공식 API 목록](https://platform.claude.com/docs/en/api/overview)                                                                                                                                                           |
| LM Studio        | `/v1/systemone`                  | lm_studio_decision; 해당 경로를 제공하는 서버와 로드된 decision model 필요. 일반 Ornith chat 모델의 지원을 가정하지 않음 | [공식 System One](https://lmstudio.ai/docs/developer/jev-compat/systemone)                                                                                                                                                  |
| llama.cpp        | `/v1/systemone`                  | llama_decision; 판정 모델·모델별 context/batch 제한 확인 필요                                                            | [공식 server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#post-v1systemone-typesafe-compatible-system-one-api)                                                                          |
| SGLang           | `/v1/systemone`                  | sglang_decision; 현재 upstream route와 choice wire 계약 확인. 설치 버전의 지원은 별도 테스트                             | [공식 route](https://github.com/sgl-project/sglang/blob/main/python/sglang/srt/entrypoints/http_server.py), [protocol](https://github.com/sgl-project/sglang/blob/main/python/sglang/srt/entrypoints/systemone/protocol.py) |
| vLLM             | `/v1/systemone`                  | vllm_decision; 지원 read strategy·logprobs mode·모델 조건 필요, 미지원 서버의 501을 생성으로 우회하지 않음               | [Structured Decisions](https://docs.vllm.ai/en/stable/models/structured_decisions_models/)                                                                                                                                  |
| LiteLLM          | `/v1/systemone`, `/v1/decisions` | litellm_decision은 System One 경로 사용. 판정 모델 deployment와 해당 release 지원 필요                                   | [공식 decision routes](https://docs.litellm.ai/docs/decisions/systemone_format)                                                                                                                                             |
| 기타 OpenAI 호환 | 판정 지원을 추정할 수 없음       | 기존 생성/구조화 bridge만 사용. Chat Completions 호환을 판정 API 호환으로 간주하지 않음                                  | 서버별 계약 검증 필요                                                                                                                                                                                                       |

Admin의 System One은 제품상 판정 모델 범주이며 모든 서비스의 URL이 `/systemone`이라는 뜻은 아니다. 카탈로그는 10개 기존 생성 protocol kind와 9개 판정 kind를 제공한다. 서버·모델 교체는 새 설정 리비전을 만들고, 이전 실행은 고정 설정을 유지한다. 모든 연결의 현재 제품 지원 범위는 텍스트 choice 배치이며 Noul·Score·Box·이미지 판정은 미구현이다.

`vllm_decision`은 일반 vLLM 서버용이며, `vllm_sr_decision`은 별도의 **vLLM-SR** Decision 연결이다. 기본 주소는 로컬 런타임 `http://127.0.0.1:8100/v1`이다. Router/호스팅은 배포 주소의 `/v1`을 입력한다. `/systemone/models`를 먼저 조회하고 404/405일 때만 standalone runtime의 `/models`를 조회한다. 인증 오류·429·5xx·잘못된 응답에서는 우회하지 않는다. 표준 `models[].name` 및 Router `data[].id`를 해석하고, 명시적 System Two/routing·choice 미지원 항목은 제외한다. 모델 ID는 하드코딩하지 않는다.

판정은 Bearer 인증(키를 입력한 경우)과 `POST /v1/systemone`을 사용한다. 호스팅의 문자열 `state` 계약에 맞춰 객체/배열은 JSON 텍스트로 직렬화하고, 기존 문자열은 그대로 전송한다. 반환 확률·confidence·usage는 기존 검증기를 통과한 값만 기록한다. 설정 리비전, 동시성·대기열, 취소, 문서 처리·자료 관계 판정은 공통 실행 계층을 재사용한다. System Two 채팅, Noul/Score/Box/Span, 모델 설치·로드는 이 연결의 구현 범위가 아니다.

공식 공개 호스팅 `https://app.vllm-sr.ai/v1`은 연구·평가 전용이며 입력/응답의 수집 정책이 있으므로 사내 운영용 기본 endpoint로 지정하지 않는다. 로컬/사내 설치는 별도 배포한 서버를 연결한다. 공개 모델 목록의 무인증 GET 응답은 확인했으며, 인증된 호스팅 추론 및 실제 로컬 엔진은 운영 검증 대상이다. 격리된 계약 서버로 Admin 조회·저장·판정·재시작·오류·동시성 설정을 검증한다. [공개 API](https://app.vllm-sr.ai/docs), [System One 계약](https://vllm-sr.ai/docs/system-one/use/api/), [runtime OpenAPI](https://github.com/vllm-project/semantic-router/blob/main/src/model-runtime/vllm_srun/api/openapi.yaml).

일반 LLM bridge는 프롬프트와 제한된 JSON 선택값을 생성한다. native System One 확률·confidence·속도를 재현한다고 표시하지 않는다. 외부 서버는 별도로 준비하며 앱 시작 시 모델 다운로드·런타임 설치를 하지 않는다. 공식 API 문서와 upstream main 소스는 변할 수 있으므로 배포 대상 버전을 고정한 contract/live 테스트가 운영 수용 조건이다.

## 설치된 문서·템플릿 실행 도구

`apalis-core =1.2.0`의 sleep 기능과 기존 futures-util sink를 사용한다. 작업은 SQLite에 보존하고 두 개의 제한된 worker가 lease·heartbeat·재시도·취소·재시작 복구를 수행한다. 이는 전체 제품용 범용 DAG 구현을 의미하지 않는다.

Kordoc 4.24.80은 `runtime/kordoc/package-lock.json`으로 고정한다. PDFium 2.1.13, Sharp 0.35.5, ONNX Runtime 1.31.1이 실제 문서·이미지·OCR 소비자에 연결되어 있다. OCR은 det.onnx·rec_korean.onnx·rec_korean.yml을 미리 설치한다. 앱 실행 시 모델을 내려받지 않는다.

PPT Master는 공식 `hugohe3/ppt-master`의 커밋 `3af3e8ef774c4d67ee57e1306d9256d08c9ee1bf`를 사용한다. 원본 귀속 검사를 유지하기 위해 전체 소스를 보관하며 `pptx_template_import.py --inheritance-mode both --embed-images`를 호출한다. 편집 구조·원본 관계는 유지하고, SVG 투영은 Sharp로 PNG 미리보기로 변환한다. 브라우저에는 원본 SVG를 실행하지 않는다. 번들 Node 26.13.0과 CPython 3.13.18로 실행하며 외부 SaaS API로 취급하지 않는다.

취득·manifest 생성 코드는 `scripts/install-document-runtime.mjs`와 `scripts/prepare-document-runtime.mjs`가 소유한다. Linux 배포 자산의 ABI·폰트·완전한 오프라인 실행 검증은 별도 수용 항목이다.

연결별 요청 처리 한도는 기존 Tokio oneshot·CancellationToken과 표준 라이브러리의 Mutex·FIFO 컨테이너를 사용한다. 프로세스 내 짧은 admission 정책이며 별도 job engine이나 외부 메시지 브로커를 추가하지 않는다. 영속 문서 작업은 기존 Apalis/SQLite 책임을 유지한다.

### Provider 모델 탐색

추가 패키지 없이 기존 reqwest/Provider adapter를 재사용한다. [OpenAI Models](https://developers.openai.com/api/reference/resources/models/methods/list), [Claude Models](https://platform.claude.com/docs/en/api/models), [Gemini Models](https://aistudio.google.com/api-reference/models), [LM Studio 네이티브 목록](https://lmstudio.ai/docs/developer/rest/list)의 인증·응답 계약을 사용한다. LM Studio 생성/호환/Decision 연결 모두 네이티브 inventory를 조회하고 실행 프로토콜은 각 연결 설정을 유지한다. SGLang은 get_model_info, llama.cpp·vLLM·LiteLLM 및 명시적 호환 서버는 해당 서버가 제공하는 models 경로를 사용한다. 모델 목록은 실행 기능 보장이 아니며 실제 배포 버전·키 권한에 따른 외부 연결 검증은 별도로 수행한다.

Kordoc 4.24.80의 [dropBlankImages 옵션](https://github.com/chrisryugj/kordoc/blob/main/docs/usage.md)을 활성화한다. 일반 추출은 공개 parse 옵션을 사용한다. PPT Master 이미지 경로에는 독립 공개 필터 API가 없어 `prepare-kordoc-filter.mjs`가 고정 버전의 실제 dropBlankImages export를 빌드 시 검증·연결한다. 비공개 export 의존성은 이 어댑터에 한정하며 버전/모듈 구조가 달라지면 빌드를 중단해 재검토한다. 생성된 연결 모듈과 실제 필터 모듈의 해시를 runtime manifest에 포함한다. 픽셀 규칙을 자체 구현하거나 별도의 작은 이미지 임계값을 추가하지 않는다.

## 관계 검색의 기존 의존성 활용

관계 검색은 설치된 SQLite FTS5, async-sqlite/rusqlite, Tokio, futures-util, SHA-256, 기존 Decisions/model_execution 어댑터를 사용한다. 벡터 DB, 그래프 서버, 별도 검색 서비스나 신규 런타임 패키지는 추가하지 않는다. FTS는 외부 content_blocks 정본을 참조하며 `ORDER BY rank`와 LIMIT를 사용한다. 정렬 근거는 [SQLite FTS5 문서](https://www.sqlite.org/fts5.html#sorting_by_auxiliary_function_results)다. 후보 출처 연결은 한 SQL 문으로 묶고 모델 비교는 Provider 종류별 입력 구성과 bounded stream으로 실행한다.

LM Studio Decision은 공식 [System One endpoint](https://lmstudio.ai/docs/developer/jev-compat/systemone)를 그대로 사용한다. 앱의 동시 HTTP 요청 제한과 LM Studio 내부 n_ubatch/컨텍스트 설정은 별개다. PuPuTyX는 모델 다운로드·로드 설정을 자동 변경하지 않는다.

## Markdown 업로드 어댑터

2026-11-16 기준 공식 registry·저장소를 비교해 **Comrak 0.59.0**을 exact pin으로 추가했다. 기본 feature를 끄고 Rust 라이브러리만 사용한다. BSD-2-Clause, MSRV 1.89로 현재 Rust 1.99와 호환한다. CLI·syntect 구문 강조나 브라우저 Markdown renderer는 추가하지 않았다.

| 후보           | 최근 안정판/활동 확인                                             | 판단                                                                      |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Comrak         | 0.59.0, 2026-10-26 릴리스; 2026-11-16까지 main 활동과 1.0 RC 개발 | CommonMark/GFM AST와 원문 위치, 표·체크리스트 지원. 선택                  |
| pulldown-cmark | 0.13.6, 2026-10-30 릴리스; 2026-11-08까지 main 활동               | 널리 사용되는 활발한 대안. 이번 블록/원문 위치 어댑터는 Comrak AST를 채택 |
| markdown-rs    | 1.0.0, 2025-04-23 안정판 및 최근 main 활동                        | AST 지원하지만 비교 시점의 최근 활동이 다른 후보보다 적음                 |
| markdown-it    | 15.0.3, 2026-10-16 릴리스                                         | 활발한 JS 대안이나 Rust 직접 처리 경로에 Node 실행을 추가할 필요 없음     |

이는 비교 후보와 확인 시점에 대한 판단이며 전체 생태계의 영구적인 활동 순위를 뜻하지 않는다. [Comrak 릴리스](https://github.com/kivikakk/comrak/releases/tag/v0.59.0), [Comrak registry](https://crates.io/crates/comrak/0.59.0), [pulldown-cmark](https://github.com/pulldown-cmark/pulldown-cmark), [markdown-rs](https://github.com/wooorm/markdown-rs), [markdown-it 변경 내역](https://github.com/markdown-it/markdown-it/blob/master/CHANGELOG.md).

Kordoc 4.24.80의 `parse()`는 Markdown 입력에 `UNSUPPORTED_FORMAT`을 반환한다. Markdown 생성/출력 기능과 입력 파싱을 구분하며, `adapters/markdown/`이 Comrak AST를 문서 정본 블록으로 변환한다. Rust 릴리스에 컴파일되고 런타임 설치·모델 다운로드는 없다. 원문 HTML과 링크/이미지 주소는 데이터로만 다루며 외부 콘텐츠를 불러오지 않는다.

Comrak의 BSD-2-Clause와 전이 의존성 `finl_unicode`의 Unicode 데이터 고지를 검토해 `deny.toml`의 허용 목록에 BSD-2-Clause·Unicode-DFS-2016을 추가했다. crate에 포함된 원문 라이선스 고지를 유지하며 릴리스 고지/SBOM 수집 대상이다.

목차·콘텐츠 구성은 기존 Tokio, SQLite/refinery, reqwest, serde/JSON Schema, 모델 실행 게이트웨이를 사용하며 새로운 작업 엔진이나 LLM SDK를 추가하지 않는다. 표 조회에는 공식 [shadcn Table](https://ui.shadcn.com/docs/components/table) source를 필요한 primitive만 가져왔고 registry URL/해시를 components.sources.json에 기록했다. 기존 Radix 계열을 유지한다.

### DR-DCI 아이디어 적용

[논문](https://arxiv.org/html/2606.14885v1)과 [공식 구현](https://github.com/EigenTom/DR-DCI)의 동적 작업 공간·문서 간 검토 개념을 기존 Rust Relations에 적용한다. Python/Pi 런타임, FAISS/Pyserini 서비스, 임의 셸 실행 의존성은 추가하지 않는다. SQLite FTS5·Tokio·futures-util·기존 Inference/Decisions·TanStack Query·Radix 기반 shadcn Collapsible를 재사용한다.

## PPT 생성 런타임

PPT Master의 네이티브 exporter가 실제로 요구하는 `python-pptx==1.0.2`를 번들 Python의 별도 `runtime/python-packages/`에 설치한다. 전이 의존성은 `scripts/runtime-python.lock`의 정확한 버전·배포 파일 해시로 잠근다. 원본 입력은 `scripts/runtime-python.in`이며 `uv pip install --target ... --require-hashes`는 명시적 설치/빌드 준비에만 사용한다. 앱 시작이나 생성 중 설치하지 않는다. 배포 휠의 라이선스 파일은 dist-info에 함께 유지한다.

python-pptx는 MIT이며 PPT Master 기본 디자인 출력의 의존성이자 업로드 템플릿의 마스터·텍스트 레이아웃 보존에 사용한다. [공식 배포](https://pypi.org/project/python-pptx/)와 [템플릿·프레젠테이션 설명](https://python-pptx.readthedocs.io/en/latest/user/presentations.html)을 기준으로 적용한다. 템플릿의 기존 슬라이드를 제거하는 공개 API는 없어 이 동작만 Python 어댑터의 내부 XML 접근으로 격리하고 실제 템플릿 master 보존 테스트로 보호한다. 임의 Office 고급 효과의 완전한 충실도는 보장하지 않는다.

PPT Master가 기본 디자인의 텍스트/도형을 네이티브 DrawingML로 출력한다. Kordoc은 생성된 PPTX 본문을 독립적으로 재추출해 제목·본문 누락을 검사한다. 기존 PPT Master 재수입과 Sharp가 수동 실행 코드 없는 PNG 미리보기를 만든다. 새 SaaS/호스팅 서비스나 브라우저 AI SDK는 추가하지 않는다.

Admin 토큰의 고정 길이 verifier 비교는 기존 잠금 파일에 있던 `subtle =2.6.1`을 직접 의존성으로 선언해 사용한다. 난수·해시·비밀 문자열은 기존 getrandom/sha2/secrecy를 재사용한다. [OWASP 세션 관리 지침](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)의 CSPRNG·충분한 엔트로피·URL 토큰 배제 원칙을 적용하되, 이 기능은 쿠키 세션이 아닌 현재 Admin 방문의 명시적 Bearer 헤더 방식이다.

## 실제 슬라이드 대화 UI

`@shadcn/react` **0.3.1**(MIT, React 19 peer)을 Message Scroller의 실제 스크롤 동작에 사용한다. 공식 Radix Chat의 Message/Bubble/Message Scroller와 InputGroup 소스 URL·해시는 `frontend/components.sources.json`에 기록한다. 기존 Radix Slot·Button·Textarea·cn을 재사용하고 Folio 라이트 스타일, 한국어 라벨, 44px 버튼에 맞췄다. 미사용 export와 중복 focus 처리는 제거했다. AI SDK, Provider SDK, Next.js와 SaaS 전송 계층은 추가하지 않는다. Rust Inference가 기존 native Provider·취소·동시성·요청 이력을 그대로 사용한다.
