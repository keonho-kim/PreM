# 의존성 구성과 도입 기준

의존성 버전은 manifest·lockfile 및 [런타임 버전 파일](../scripts/runtime-versions.json)이 소유한다. 이 문서는 실제 소비자와 라이선스·런타임 경계를 설명한다. 설치 여부를 기능 완료의 근거로 사용하지 않는다.

## Rust 실행 의존성

Rust/Axum/Tokio가 HTTP·비동기 실행·취소를, rusqlite/refinery가 단일 SQLite와 전진 migration을 담당한다. SQLite는 bundled다. 모델 전송은 reqwest/rustls, 비밀 설정은 XChaCha20Poly1305, 문서/아카이브 구조는 각 포맷의 기존 parser를 사용한다. [Cargo.toml](../Cargo.toml)과 [Cargo.lock](../Cargo.lock)이 정확한 버전·feature를 고정한다.

## React HTTP·상태·훅 구성

| 소유 책임                  | 구현                        |
| -------------------------- | --------------------------- |
| 경로·검색·이력             | TanStack Router             |
| 서버 확정 데이터           | TanStack Query              |
| HTTP·취소·공개 오류        | Axios + Zod                 |
| UI 상태·범위별 미전송 초안 | Redux Toolkit + React Redux |
| 모델 설정 폼               | React Hook Form             |
| 파일 전송 큐               | Uppy                        |
| UI primitive               | 공식 shadcn source와 Radix  |
| 직접 캔버스 조작           | react-rnd                   |

필요한 기능의 기존 훅을 조합하며 중복 store/transport를 추가하지 않는다. 컴포넌트의 upstream source·해시는 [components.sources.json](../frontend/components.sources.json), 고지는 [THIRD_PARTY_NOTICES.md](../frontend/THIRD_PARTY_NOTICES.md)에 있다. 일반 UI와 AI Elements의 표시 패턴을 재사용하지만 모델 실행·권한은 Rust가 소유한다.

## 개발 도구와 실행 번들

Node는 [.node-version](../.node-version), pnpm은 [package.json](../package.json), Rust는 [rust-toolchain.toml](../rust-toolchain.toml), Python·uv·PPT Master·Puppeteer는 [runtime-versions.json](../scripts/runtime-versions.json), Rust 개발 CLI는 [dev-tools.json](../scripts/dev-tools.json)이 소유한다. `pnpm check:versions`는 제품 버전·lock·검토된 Kordoc 어댑터와 릴리스 태그의 일치를 검사한다. CI는 이 파일에서 버전을 읽는다.

제품 번들에는 Node·Python·Kordoc/OCR·PPT Master·Python 패키지·폰트·라이선스가 포함된다. npm/uv/cargo/브라우저 자동화 도구는 설치·개발 단계의 도구다. 실행 중 패키지나 모델을 설치하지 않는다. LLM/Decision 추론 서버·가중치는 별도로 연결한다.

## 라이선스와 전문 엔진

사내 팀 사용에 필요한 유지보수·로컬 실행·실제 전이 고지를 검토한다. GPL/MPL/AGPL이라는 이유로 일괄 제외하지 않으며, 실제 사용 범위와 배포물의 고지를 확인한다. Python 패키지는 해시 잠금 파일, Node 런타임 패키지는 npm lockfile을 사용한다. `package-release.py`가 upstream 고지와 의존성 inventory를 묶는다.

LibreOffice·H2Orestart·Java Office PDF 정규화는 아직 제품에 연결하지 않았다. 코어 문서 추출과 PPT 생성은 아래 실제 도구 경로를 사용한다.

## 문서 실행 의존성과 진행 표시

문서·템플릿 작업은 `workflows/engine`의 공통 Driver를 사용하며 `apalis-core`를 Cargo manifest/lock에서 제거했다. 목차 생성·내용 연결도 같은 엔진 Driver와 기존 Tokio/SQLite를 사용한다. 새 런타임 의존성은 추가하지 않았다. Tokio의 제한된 두 실행 슬롯·CancellationToken·작업 join, 기존 async-sqlite/SQLite lease와 체크포인트, refinery migration을 사용한다. Kordoc·PPT Master·Comrak과 모델 실행 경계는 유지한다.

준비 상태는 기존 Lucide 아이콘과 shadcn Progress/Button으로 표시한다. Modern Web Guidance `progress`의 측정 가능한 값만 표시하고 완료 시 초점을 이동하지 않는 지침을 적용한다. 추출 중에는 단계·텍스트 상태를, 분류 중에는 완료 블록 수의 실제 비율을 표시한다. 강제 색상에서도 현재 단계의 경계를 보존한다. 새 UI/훅/큐 라이브러리는 도입하지 않는다.

## Native source reuse runtime

Native source insertion uses the already pinned python-pptx 1.0.2 and PPT Master runtime. `presentation-references.py` is the product adapter over their OPC/shape model; no new merger dependency or runtime installer was added. The adapter copies native parts, chart workbooks and source theme/layout relationships, remaps IDs and preserves image/source aspect ratios. Source validation, quotas, revision commits and model allowlists remain product responsibilities.

The investigated [pptx-slide-merger](https://github.com/rwunsch/pptx-slide-merger) explicitly excludes charts/OLE in its current README and is not installed. The working implementation is verified with native chart/workbook fixtures rather than treating a dependency review as format fidelity proof. Browser selection reuses shadcn Dialog/Select/Button and existing Query/Axios; DialogTrigger is the existing official Radix primitive alias. No UI package family was changed.

## Canvas direct interaction

Outline generation scope uses the official [shadcn/ui Radix Checkbox](https://ui.shadcn.com/docs/components/radix/checkbox) source and pinned `@radix-ui/react-checkbox` **1.4.1** (MIT, React/React DOM 16.8–19 peers). Its registry URL/hash are recorded in `frontend/components.sources.json`; Folio colors, mixed-state icon and label target sizing are local bindings. Radix owns keyboard, form and checked/indeterminate behavior. Generation scope rules, revision drafts and server validation remain product responsibilities. This adds one consumed browser primitive without changing the existing Radix component family.

| Dependency                     | Version                 | Actual consumer                                                         | Runtime/build boundary                                       |
| ------------------------------ | ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| react-rnd                      | 10.5.3                  | ObjectSelection: drag/resize, bounds and aspect lock                    | Vite browser bundle; MIT, React/React DOM >=16.3 peers       |
| react-draggable / re-resizable | pnpm lockfile pins      | react-rnd gesture/resize implementation                                 | Transitive browser runtime; no application-time installation |
| python-pptx / lxml / Sharp     | Existing pinned runtime | Native layout catalog, authored empty slides and passive artwork layers | Bundled local process adapters; no new server package        |

The [react-rnd upstream documentation](https://github.com/bokuweb/react-rnd) defines controlled position/size, resize/drag callbacks, bounds and aspect lock. Product code owns IDs, percentage geometry, group clamping, cancellation, keyboard/numeric alternatives, immutable revision commits and shared CAS. The library does not own provider calls, data storage or application authorization. Dependencies remain pinned in manifests/lockfiles and are installed during development/build only.

## 프론트엔드 라우팅·폼·구조 검사 의존성

| 패키지                             | 고정 버전      | 용도                                                        | 라이선스/호환성                            |
| ---------------------------------- | -------------- | ----------------------------------------------------------- | ------------------------------------------ |
| `@tanstack/react-router`           | 1.170.46       | 기존 React Router를 대체하는 제품 라우팅·경로 타입·URL 상태 | MIT, React 18/19, Node 20.19+              |
| `react-hook-form`                  | 7.92.0         | 모델 연결 폼 입력·dirty·reset·제출 관리                     | MIT, React 19 지원, Node 18+               |
| `@reduxjs/toolkit` / `react-redux` | 2.14.0 / 9.3.1 | 작업 패널·미전송 대화 초안, Zustand 대체                    | MIT, React 19 지원                         |
| `dependency-cruiser`               | 18.8.0         | 개발 전용 순환 참조·계층·feature 경계 검사                  | MIT, Node 22/24/26+, 배포 실행 의존성 아님 |

공식 공급원은 [TanStack Router](https://github.com/TanStack/router), [React Hook Form](https://github.com/react-hook-form/react-hook-form), [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)다. 잠금 파일로 전이 의존성을 고정하며 호환성은 현재 React 19.3.1·Node 26.13.0에서 검사한다. 기존 Axios·TanStack Query·Zod·Redux Toolkit·Uppy와 역할을 나눈다. React Router는 제품과 테스트에서 제거한다. React Hook Form에 별도 resolver 패키지를 추가하지 않고 현재 HTML 제약과 서버/API 검증을 유지한다.

실행 중 패키지를 설치하지 않는다. Router/Form은 프론트엔드 빌드에 포함되고 dependency-cruiser는 개발 검사에만 사용한다. 설치된 정확한 구성은 `frontend/package.json`과 `pnpm-lock.yaml`이 소유한다.

Redux store는 app의 composition root에서 생성하고, reducer는 해당 기능/공유 UI 소유자에 둔다. selector는 자신이 사용하는 상태 조각만 선언해 feature가 app 구현을 역참조하지 않는다. 미전송 대화는 project·revision·slide별 최대 128개이며 브라우저 영속 저장을 하지 않는다. Redux DevTools에는 입력 초안을 노출하지 않도록 앱 store의 DevTools 연결을 끈다. [Redux Toolkit 공식 구성](https://redux-toolkit.js.org/usage/usage-with-typescript/)을 따른다.

## Kordoc PDF 런타임

Kordoc은 `runtime/kordoc/package.json`에서 **4.24.83**으로 고정하고 npm lockfile의 integrity로 설치한다. PDF 텍스트는 패키지에 포함된 `dist/hayro-pdf.wasm`을 사용하며, OCR 래스터·페이지 미리보기는 기존 PDFium을 사용한다. PDF 처리에 `pdfjs-dist`·`@napi-rs/canvas`가 필요하지 않다. hayro WASM과 해당 `THIRD_PARTY` 고지는 Kordoc 디렉터리와 함께 번들에 포함된다. [공식 변경 사항](https://github.com/chrisryugj/kordoc/blob/main/CHANGELOG.md)을 따른다.

프로덕션 OCR 설정은 `ocrRec: printed`, `ocrDet: mobile`, `formulaOcr: false`다. 인쇄 한국어 검출·인식·사전 파일을 빌드 때 검증하고, 실행 시 쓰기 가능한 앱 전용 캐시에 복사한 뒤 `KORDOC_OFFLINE=1`로 사용한다. 런타임 manifest는 실제 설치 버전과 PDF WASM의 SHA-256도 포함한다. 이미지 필터는 검토된 Kordoc 버전에 고정하고 upstream 함수를 그대로 연결한다.

## System One / Decisions API 지원 조사

실제 공급자 종류·지원 능력은 [model_registry](../backend/src/modules/model_registry/)의 카탈로그가 소유한다. native 판정 어댑터는 제공된 state와 choice 질문을 각 프로토콜에 맞춰 전송하고, LLM bridge는 일반 생성 연결의 구조화 출력을 사용한다. 전체 클라우드 계정 수용을 의미하지 않으며 synthetic HTTP 계약과 실모델 acceptance를 구분한다. 공급자가 지원하지 않는 프로토콜로 자동 전환하지 않는다.
