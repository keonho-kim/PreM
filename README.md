# PuPuTyX

기업 문서의 분석·근거 연결·편집 가능한 프레젠테이션 제작을 위한 플랫폼.

현재 제품은 **공유 프로젝트, Space 자료 등록·검색, 문서 추출·OCR, Studio의 목차·근거·템플릿 선택, 편집 가능한 PPTX 생성과 대화 기반 텍스트 수정**을 제공한다. Rust/Axum API와 React 화면이 연결되어 있으며 SQLite에 저장해 재시작 후에도 유지된다. 일반 이용에는 로그인이 없고 Admin만 서버 시작 시 발급되는 토큰을 요구한다. 웹 캔버스의 객체 편집은 아직 목업 범위다.

## 개발 문서

[dev-docs 문서 색인](dev-docs/README.md)에서 현재 구현의 범위와 계약을 확인한다.

| 문서                                                 | 내용                               |
| ---------------------------------------------------- | ---------------------------------- |
| [아키텍처](dev-docs/01-architecture.md)              | 실행 경계와 모듈 소유권            |
| [업무 흐름](dev-docs/02-product-workflows.md)        | Home·Studio·Space·Admin            |
| [편집기](dev-docs/03-editor.md)                      | 직접 편집·다중 선택·AI 대화·리비전 |
| [데이터·API](dev-docs/04-data-api.md)                | 메모리 모델·파일·JSON·HTTP         |
| [디자인·접근성](dev-docs/05-design-accessibility.md) | Folio 토큰과 조작 규칙             |
| [실행·운영](dev-docs/06-development-operations.md)   | 개발 환경·설정·빌드·장애 대응      |
| [품질·운영 준비도](dev-docs/07-quality-readiness.md) | 검증 명령·보안 경계·운영 수용 조건 |

[의존성 구성·추가 후보](dev-docs/08-dependencies.md)에는 설치 버전과 feature, 소비 모듈, 도입 조건을 정리했다.

제품·기술 요구사항은 [blueprint](blueprint/README.md)가 담당한다. 현재 구현과 목표 요구사항은 구분한다.

## 목업 시작

```sh
python3 mock/helpers/serve.py
```

`http://127.0.0.1:5174/`에서 연다. 서버 없이 `mock/index.html`을 직접 열 수도 있다. 상태는 브라우저 메모리에만 보관되며 새로고침하면 초기화된다.

## 제품 개발 기반 실행

Rust·Node.js·pnpm 버전은 [개발 환경](dev-docs/06-development-operations.md)을 따른다.

```sh
./scripts/setup.sh
pnpm runtime:install
pnpm dev
```

React는 `http://127.0.0.1:5173/home/`, Rust는 `http://127.0.0.1:8000`에서 실행된다. Home은 공유 프로젝트 목록, Studio는 발표자료 제작, Space는 공용 자료 검색·관리, Admin은 모델·시스템 설정을 담당한다. `pnpm runtime:install`은 uv와 네트워크가 필요한 명시적 설치 단계이며, 앱 실행 중에는 패키지나 OCR 모델을 다운로드하지 않는다. 지원 운영체제와 추가 변환 도구 조건은 [실행·운영](dev-docs/06-development-operations.md)을 따른다.

Rust는 Clippy·cargo-machete·cargo-deny·nextest를 사용하고, Rust/React 커버리지는 `pnpm coverage`로 생성한다.

Node 코드 검사·포맷은 Biome, 타입 검사는 TypeScript, 의존성 정리는 Knip을 사용한다. React 성능 분석은 [공식 DevTools 브라우저 확장](dev-docs/06-development-operations.md)으로 수행한다.

## 빌드·검사

```sh
pnpm check
pnpm build
pnpm smoke
pnpm test:e2e
pnpm coverage
```

빌드한 실행 파일을 로컬에서 실행하려면:

```sh
./target/release/PuPuTyX --data-storage-path "$PWD/data" --listen-address 127.0.0.1
```

이 빌드는 React를 포함한 Rust 서버이며, 외부 문서 처리 런타임을 갖춘 운영 릴리스 패키지는 아니다. 브라우저 목업 검사 명령은 [품질 문서](dev-docs/07-quality-readiness.md)에 있다.

## 저장소 구성

| 경로         | 역할                     |
| ------------ | ------------------------ |
| `dev-docs/`  | 현재 구현·개발·검증 문서 |
| `blueprint/` | 제품·아키텍처 요구사항   |
| `backend/`   | Rust 애플리케이션        |
| `frontend/`  | React 애플리케이션       |
| `mock/`      | 독립적인 UI 목업         |
| `design/`    | 공통 디자인 토큰 원본    |
| `scripts/`   | 개발·빌드·검사 진입점    |
| `runtime/`   | 제품 런타임 자산 위치    |
| `tests/`     | 제품 검사와 fixture      |
| `data/`      | 앱 소유 개발 데이터      |

개발 데이터는 저장소 루트의 `./data/` 아래에만 둔다. 목업 도구는 `mock/helpers/`, 임시 검증 출력은 `mock/helpers/.artifacts/`, 화면 캡처는 `mock/captures/`에 둔다.

개발은 기능별로 Rust 저장·API와 React 화면을 함께 완성한다. 실제 구현과 목업의 경계는 [개발 문서](dev-docs/README.md)를 따른다.

Git에는 소스·설계·테스트 fixture·의존성 잠금 파일을 보관한다. `data/`, 설치된 런타임, 빌드 결과, QA 임시 파일과 생성 캡처 이미지는 제외한다. 문서의 캡처 링크는 로컬 검증 산출물을 가리키며 새 checkout에서는 해당 검사를 실행해 생성한다.
