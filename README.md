# PreM — Presentation Manager

사내 팀이 함께 사용하는 문서 분석·편집 가능한 프레젠테이션 제작 플랫폼입니다. Rust/Axum 서버, SQLite, React/TypeScript·shadcn/ui로 구성합니다.

- **Home**: 모든 접속자가 공유하는 프로젝트 목록·검색·마감일 관리
- **Studio**: 원본 등록 → 작성 방향 → 목차·내용 → 근거 → 템플릿 → PPT 생성·편집
- **Space**: 공용 레퍼런스·템플릿 등록·추출·검색
- **Admin**: LLM/Decision 연결·처리 설정·진단. 서버 시작 시 발급되는 토큰으로 진입

실제 PPTX 생성·다운로드, 대화 기반 텍스트·이미지·차트·배치 수정과 여러 장표 편집을 지원합니다. 일반 사용에는 로그인이 없습니다. 웹 캔버스의 직접 드래그 조작 등 목업과 제품의 구현 차이는 [편집기 문서](dev-docs/03-editor.md)에서 확인하세요.

## 릴리스로 실행하기

[GitHub Releases](https://github.com/keonho-kim/PreM/releases)에서 OS와 CPU에 맞는 날짜 버전 `vYYYYMMDD` 압축 파일과 `.sha256`을 받습니다. macOS M 시리즈는 `macos-arm64`, Linux는 `linux-arm64` 또는 `linux-amd64`입니다.

압축을 풀고 설치 폴더에서 실행합니다.

```sh
./PreM --data-storage-path /absolute/path/to/data --listen-address 127.0.0.1
```

`http://127.0.0.1:8000/home/`에서 사용하며 Admin 토큰은 실행 터미널에서 확인합니다. Node·Python·문서 도구·한국어 OCR 모델·한국어 폰트가 번들에 포함되어 있어 실행 중 패키지나 OCR 모델을 설치하지 않습니다. LLM/Decision 추론 서버와 그 모델 가중치는 별도 서비스이며 Admin에서 연결합니다. OS 자체의 libc·커널·macOS 시스템 프레임워크는 호스트가 제공합니다. Linux는 glibc 2.39 이상(Ubuntu 24.04 이상), macOS는 14 이상을 대상으로 합니다. macOS 앱 공증은 적용하지 않습니다.

업데이트할 때 새 압축은 별도 폴더에 풀고 기존 데이터 절대 경로를 그대로 지정합니다. 기존 실행을 먼저 종료하며 DB와 Blob·암호화 키를 함께 보관합니다. 소스 저장소·개발 도구는 실행에 필요하지 않습니다. 파일별 해시와 소스 커밋은 압축 안 `RELEASE.json`, 의존성과 라이선스는 `DEPENDENCIES.json`과 `licenses/`에 있습니다.

## 1. 준비 사항

명령은 별도 안내가 없으면 **프로젝트 루트**에서 실행합니다.

| 도구                | 기준                            | 용도                                                                     |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| Rust + rustup       | `1.99.1`                        | 서버·개발 CLI·LLVM 도구. [rust-toolchain.toml](rust-toolchain.toml) 기준 |
| Node.js + npm       | `26.13.0` 기준, `>=26.13.0 <27` | 프론트엔드·설치 스크립트. [.node-version](.node-version) 기준            |
| pnpm                | `12.16.1`                       | 워크스페이스 의존성·명령 실행                                            |
| uv                  | PATH에서 실행 가능              | 번들 Python 및 고정 Python 의존성 설치                                   |
| Bash·tar·Python 3   | PATH에서 실행 가능              | 설치·빌드·Smoke 검사·목업 서버                                           |
| C/C++ 컴파일러·링커 | 호스트에 맞게 준비              | Rust 네이티브 의존성 빌드                                                |
| Chrome/Chromium     | 브라우저 검사 시 필요           | 실제 화면 E2E 검사                                                       |

고정 버전은 [package.json](package.json)과 도구 설정 파일이 기준입니다. pnpm이 없다면 준비된 Node/npm 환경에서 설치합니다.

```sh
npm install --global pnpm@12.16.1
```

전체 통합 검증은 **macOS arm64**에서 실행합니다. 릴리스는 macOS arm64와 Linux arm64/amd64의 네이티브 runner에서 각각 빌드·검증하며, Linux 번들은 추가 패키지가 없는 Ubuntu 24.04에서도 네트워크 없이 검사합니다. 개발 실행은 POSIX 프로세스 그룹을 사용하므로 Windows 네이티브 실행은 검증 대상에 포함되지 않습니다.

Space·Studio의 파일 준비와 Studio 목차 생성·내용 연결·근거 검색·대화 수정은 공통 실행 엔진의 저장된 단계로 표시합니다. 우측 하단 작업 패널에서 취소·재시도할 수 있으며, 재시작하면 완료한 추출·분류·목차/매핑 배치를 재사용합니다. 목차의 최종 저장만 실패하면 모델을 다시 호출하지 않고 저장부터 재시도합니다. 템플릿은 전용 미리보기 준비로 처리하고 프로젝트 원본은 Space에 자동 등록하지 않습니다.

## 2. 처음 설치하고 실행하기

비공개 저장소에 접근할 수 있는 GitHub 계정으로 가져옵니다. 이미 작업 폴더가 있다면 `clone`과 `cd`를 건너뜁니다.

```sh
git clone https://github.com/keonho-kim/PreM.git
cd PreM

./scripts/setup.sh
pnpm runtime:install
pnpm dev
```

1. `setup.sh`: 잠금 파일 기준 Node/Rust 의존성과 고정 Rust 개발 도구를 설치합니다.
2. `runtime:install`: 문서 처리용 Node·Python·Kordoc·OCR 모델·PPT Master와 Python 패키지를 `runtime/`에 준비합니다. 최초 설치에는 네트워크가 필요하며 시간이 걸릴 수 있습니다.
3. `dev`: Rust 서버와 Vite 개발 서버를 함께 실행합니다. 저장 경로와 DB는 자동 생성합니다.

브라우저에서 **[http://127.0.0.1:5173/home/](http://127.0.0.1:5173/home/)**을 열면 프로젝트 목록이 표시됩니다. 프로젝트가 없으면 생성 안내가 보입니다. `Ctrl+C`로 두 개발 서버를 함께 종료합니다.

의존성 설치는 개발·빌드 준비 단계에서 수행합니다. 앱 실행 중에는 패키지·OCR 모델을 다운로드하지 않습니다. LLM 호출에는 설정한 모델 서버/API에 대한 연결이 필요합니다.

## 3. 개발 서버 실행

| 명령                       | 실행 내용                                         |
| -------------------------- | ------------------------------------------------- |
| `pnpm dev`                 | 백엔드와 프론트엔드 함께 실행, 데이터는 `./data/` |
| `pnpm dev sandbox`         | 함께 실행하되 데이터는 `./data/sandbox/`          |
| `pnpm dev:backend`         | Rust 서버만 실행                                  |
| `pnpm dev:backend sandbox` | 별도 데이터 폴더로 Rust 서버만 실행               |
| `pnpm dev:frontend`        | Vite만 실행. API를 사용하려면 백엔드도 필요       |

| 주소                               | 역할             |
| ---------------------------------- | ---------------- |
| `http://127.0.0.1:5173/home/`      | 개발용 웹앱      |
| `http://127.0.0.1:8000/healthz`    | 백엔드 상태 확인 |
| `http://127.0.0.1:8000/api/v1/...` | 업무 API         |

Vite는 `/api`와 `/healthz`를 `127.0.0.1:8000`으로 전달합니다. 개발 스크립트는 백엔드 `8000`, Vite `5173` 포트를 사용합니다. 데이터 폴더 이름만 바꿔도 포트는 그대로이므로 여러 개발 서버가 동시에 실행되는 것은 아닙니다.

프론트엔드 수정은 Vite가 반영합니다. **Rust 수정은 자동 재시작되지 않으므로** 실행 중인 `pnpm dev`를 종료한 뒤 다시 실행합니다. `backend/tools/`를 변경했다면 종료 후 다음 명령으로 런타임 복사본도 갱신합니다.

```sh
node scripts/prepare-document-runtime.mjs
pnpm dev
```

## 4. DB·업로드 파일 저장 위치

개발 데이터의 기본 위치는 **이 프로젝트의 `./data/`**입니다. 파일시스템 루트의 `/data/`를 의미하지 않습니다. 개발 스크립트는 이름별 하위 폴더를 절대 경로로 변환해 서버에 전달합니다.

```text
data/
├── db/app.sqlite          # SQLite와 WAL/SHM
├── blobs/sha256/          # 원본·생성 파일의 공통 Blob
├── config/secret.key      # Provider 설정 암호화 키
├── projects/              # 프로젝트 작업 공간
├── libraries/             # 라이브러리 작업 공간
├── work/                  # 도구 작업 파일
├── tmp/
├── logs/
└── backups/               # Migration 전 DB 백업
```

서버 직접 실행 시에는 필수 인자 `--data-storage-path`로 **절대 경로**를 지정합니다.

```sh
./target/release/PreM \
  --data-storage-path "$PWD/data" \
  --listen-address 127.0.0.1 \
  --port 8000
```

없는 경로는 생성하고 기존 경로의 데이터는 유지합니다. 같은 저장소를 동시에 여는 인스턴스는 잠금으로 차단합니다. 경로를 바꿔도 기존 데이터가 자동 이관되지는 않습니다. 스키마 변경 시 DB를 백업한 뒤 Migration을 적용하며, 손상되거나 더 새로운 DB를 초기화해서 덮어쓰지 않습니다.

업로드 파일은 DB 밖에 있으므로 복구용 백업에는 DB뿐 아니라 Blob과 암호화 키도 포함해야 합니다. 현재 자동 백업은 **Migration 전 DB 백업**이며 정기 전체 스토리지 백업을 대신하지 않습니다.

## 5. Admin과 모델 설정

1. 서버 실행 터미널의 `PreM Admin token: ...` 값을 확인합니다.
2. 웹앱의 **Admin**에서 토큰을 입력합니다.
3. 모델 연결에서 Provider·주소·필요한 API Key를 입력하고 모델 목록을 조회해 저장합니다.
4. 연결을 확인한 뒤 Studio의 AI 작성·편집 기능을 사용합니다.

LLM Provider는 환경변수 대신 Admin에서 관리하며 설정 변경에 서버 재시작이 필요하지 않습니다. LM Studio Native의 로컬 주소 예시는 `http://127.0.0.1:1234/api/v1`입니다. 모델 실행·다운로드·로드는 별도로 준비해야 합니다.

Admin 일반 설정에서 바꾼 토큰은 현재 실행 동안만 유효합니다. **서버를 재시작하면 새 임의 토큰을 발급**합니다. 이 토큰은 일반 프로젝트·Studio·Space 이용에 필요하지 않습니다. Provider 암호화 키와 Admin 진입 토큰은 서로 다른 값입니다.

## 6. 빌드와 빌드 결과 실행

설치와 런타임 준비를 마친 뒤 실행합니다.

```sh
pnpm build
```

빌드는 디자인 토큰 검사 → 로컬 도구 준비·검사 → TypeScript/Vite 빌드 → React 정적 파일을 포함한 Rust release 빌드 순서입니다.

- 프론트엔드 산출물: `frontend/dist/`
- 실행 파일: `target/release/PreM`

개발 서버를 종료한 뒤 빌드 결과를 실행합니다.

```sh
./target/release/PreM --help
./target/release/PreM \
  --data-storage-path "$PWD/data" \
  --listen-address 127.0.0.1
```

빌드된 앱은 **[http://127.0.0.1:8000/home/](http://127.0.0.1:8000/home/)**에서 사용합니다. 이때 Vite는 필요하지 않습니다.

문서 처리 도구는 실행 파일에 들어가지 않고 `runtime/`에 있습니다. 다른 위치로 옮길 때는 같은 플랫폼에서 준비한 런타임도 제공해야 합니다. 서버는 실행 파일 옆의 `runtime/`을 우선 탐색하며, `APP_DOCUMENT_RUNTIME_PATH`로 별도 위치를 지정할 수도 있습니다. 저장소 안에서 개발할 때는 프로젝트의 `runtime/`을 사용합니다.

`pnpm build`는 실행 파일을 빌드합니다. `pnpm release:package -- vYYYYMMDD`는 현재 호스트의 런타임을 포함한 릴리스 압축을 만들고, `pnpm release:verify -- <archive>`로 재배치 실행을 확인합니다. GitHub의 Release workflow는 세 네이티브 환경에서 빌드·검증한 파일을 draft 릴리스에 업로드합니다. 모두 검증한 뒤 draft를 게시합니다. LibreOffice·H2Orestart·Java 기반 Office PDF 정규화도 아직 제품에 연결되지 않았습니다. 런타임·라이선스·플랫폼 검증 범위는 [runtime 안내](runtime/README.md)와 [운영 준비도](dev-docs/07-quality-readiness.md)를 따릅니다.

### 직접 실행 옵션

| 인자/환경변수                               | 기본값·동작                                                          |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `--data-storage-path`                       | 필수, 공통 저장 루트의 절대 경로                                     |
| `--listen-address` / `APP_LISTEN_ADDRESS`   | 직접 실행 기본값 `0.0.0.0`; 개발 스크립트는 `127.0.0.1`              |
| `--port` / `APP_PORT`                       | `8000`                                                               |
| `--log-level` / `APP_LOG_LEVEL`             | `info`                                                               |
| `--secret-key-file` / `APP_SECRET_KEY_FILE` | 미지정 시 저장 루트에 키 생성. 지정 시 기존 키 파일의 절대 경로 필요 |
| `APP_DOCUMENT_RUNTIME_PATH`                 | 준비된 외부 문서 런타임의 경로                                       |

CLI 인자는 대응 환경변수보다 우선합니다. Rust 서버는 `.env` 파일을 자동으로 읽지 않습니다. 별도 Reference·Template·Blob 저장 경로 환경변수는 설계 항목이며 현재 구현된 실행 옵션으로 취급하지 않습니다. 외부 호스트에서 접근하는 운영 서버의 네트워크 제한·HTTPS는 회사 인프라에서 구성합니다.

## 7. 검사와 테스트

| 명령                                 | 범위                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `pnpm check`                         | 도구·토큰·포맷·lint·미사용 의존성·Rust/React 테스트·Clippy·의존성 검사 |
| `pnpm typecheck`                     | TypeScript 타입 검사                                                   |
| `pnpm lint`                          | Biome 코드 검사                                                        |
| `pnpm format:check`                  | 포맷 확인                                                              |
| `pnpm format`                        | 포맷 적용: 파일을 변경함                                               |
| `pnpm test`                          | Rust와 React 테스트                                                    |
| `pnpm --filter @prem/frontend test`  | React 테스트만 실행                                                    |
| `pnpm smoke`                         | release 빌드 후 실제 실행 파일 Smoke 검사                              |
| `./scripts/smoke-test.sh --no-build` | 이미 빌드한 실행 파일의 Smoke 검사                                     |
| `pnpm test:e2e`                      | 별도 브라우저 도구 준비 후 실제 UI 흐름 검사                           |
| `pnpm coverage`                      | Rust·React 커버리지, `tests/.artifacts/coverage/`에 저장               |
| `pnpm tokens` / `pnpm tokens:check`  | 공유 디자인 토큰 생성 / 일치 여부 확인                                 |

Rust 통합 검사는 설치된 문서 런타임을 사용합니다. 토큰 생성 원본은 `design/refract.tokens.json`이며 생성된 CSS는 직접 수정하지 않습니다. `pnpm check`의 취약점 조회 등은 네트워크를 사용할 수 있습니다. E2E·Smoke·실모델 검사는 각각 별도 실행 항목입니다.

### 브라우저 E2E 준비

Chrome/Chromium과 `puppeteer-core`가 필요합니다. 브라우저 도구를 제품 의존성과 분리해 다음 위치에 설치할 수 있습니다. 아래 버전은 현재 브라우저 검증에 사용한 버전입니다.

```sh
mkdir -p mock/helpers/.artifacts/browser-tools
npm install --prefix "$PWD/mock/helpers/.artifacts/browser-tools" \
  --save-exact puppeteer-core@25.17.0

export PREM_BROWSER_TOOLS="$PWD/mock/helpers/.artifacts/browser-tools"
# Chrome 실행 파일을 자동으로 찾지 못할 때만 지정
# export CHROME_PATH="/absolute/path/to/chrome"

pnpm build
pnpm test:e2e
```

E2E는 임시 포트와 `tests/.artifacts/`의 격리된 서버 데이터를 사용하며, 개발용 `data/`에 테스트 프로젝트를 만들지 않습니다. 화면 캡처는 `mock/captures/folio/`에 저장합니다. 기본 AI 응답은 합성 계약 서버를 사용하며, 실제 모델 검증은 [품질 문서](dev-docs/07-quality-readiness.md)에 설명된 명시적 옵션으로 실행합니다.

## 8. 독립 목업 실행

```sh
python3 mock/helpers/serve.py
# 포트를 바꾸려면
python3 mock/helpers/serve.py --port 5175
```

기본 주소는 `http://127.0.0.1:5174/`입니다. 서버 없이 `mock/index.html`을 직접 열 수도 있습니다. 목업에는 Rust·React·DB가 필요하지 않으며, 상태는 브라우저 메모리에만 두고 새로고침하면 초기화합니다. 목업의 문서 분석·AI·생성은 시뮬레이션입니다.

## 9. 자주 발생하는 문제

| 증상                           | 확인·대응                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Node/pnpm 버전 오류            | `.node-version`과 `package.json` 확인                                                                              |
| Rust 도구가 없거나 버전 불일치 | `pnpm tools:install`, 이후 `pnpm tools:check`                                                                      |
| 런타임 누락·무결성 오류        | 최초 설치는 `pnpm runtime:install`; 도구 소스 변경 후에는 서버 종료 후 `node scripts/prepare-document-runtime.mjs` |
| 개발 중 `8000/home`이 503      | 기본 개발 바이너리는 UI를 포함하지 않음. `5173/home/` 사용                                                         |
| `5173` 또는 `8000` 포트 충돌   | 기존 서버를 정상 종료. 데이터 폴더 분리만으로 포트가 바뀌지는 않음                                                 |
| 저장소 잠금 오류               | 동일 경로를 사용하는 프로세스 확인. 실행 중인 잠금 파일을 삭제하지 않음                                            |
| 상대 경로 오류                 | 직접 실행 인자를 `"$PWD/data"` 같은 절대 경로로 지정                                                               |
| Admin 토큰이 맞지 않음         | 현재 서버 터미널 확인. 재시작 이전 토큰은 무효                                                                     |
| LLM 호출 불가                  | Admin의 연결 주소·활성 모델·인증 설정과 모델 서버 실행 상태 확인                                                   |
| E2E에서 브라우저를 찾지 못함   | `PREM_BROWSER_TOOLS`와 `CHROME_PATH` 확인                                                                          |

## 10. 저장소와 Git 관리

| 경로                                         | 책임                                          |
| -------------------------------------------- | --------------------------------------------- |
| `backend/`, `frontend/`                      | 실제 제품 코드·테스트·DB Migration            |
| `blueprint/`                                 | 제품·아키텍처 요구사항, 최대 10개 문서        |
| `dev-docs/`                                  | 현재 구현·실행·검증 계약                      |
| `design/`, `design.md`                       | Folio 디자인 원본·적용 기준                   |
| `scripts/`                                   | 설치·개발·빌드·검사 진입점                    |
| `runtime/`                                   | 설치된 문서 도구·모델. 설치 입력만 Git에 보관 |
| `tests/fixtures/`                            | 검토된 공개·합성 테스트 자료와 라이선스       |
| `tests/.artifacts/`                          | 폐기 가능한 제품 QA 출력                      |
| `mock/`, `mock/helpers/`                     | 독립 목업·개발 보조 소스                      |
| `mock/helpers/.artifacts/`, `mock/captures/` | 임시 도구·프로필·캡처                         |
| `data/`                                      | 앱이 사용하는 데이터만 저장                   |

[.gitignore](.gitignore)는 앱 데이터·키·환경 파일·설치 의존성·런타임·빌드·프로파일·QA 출력·캡처 이미지를 제외합니다. 캡처 폴더의 README는 남기며, 이미지 링크는 로컬 검사를 실행한 뒤 사용할 수 있습니다.

다음 재현 입력은 Git에 보관합니다: `Cargo.lock`, `pnpm-lock.yaml`, `scripts/runtime-python.in`, `scripts/runtime-python.lock`, `runtime/kordoc/package.json`, `runtime/kordoc/package-lock.json`, 도구 소스와 라이선스. 테스트 문서·이미지·폰트를 확장자 전체 규칙으로 제외하지 않습니다.

환경 예제나 공유 IDE 설정에는 실제 자격증명을 넣지 않습니다. Admin 시작 토큰·API Key·실제 업무 문서는 커밋 대상이 아닙니다. `.gitignore`는 이미 추적 중인 파일을 소급해서 제외하지 않습니다. 파일을 확인할 때는 다음 읽기 전용 명령을 사용합니다.

```sh
git status --short
git check-ignore -v data/db/app.sqlite
git ls-files -ci --exclude-standard
```

마지막 명령은 추적 중이면서 현재 제외 규칙에도 해당하는 파일을 보여줍니다. 기록에서 제거할 필요가 있다면 실제 데이터와 기존 커밋을 먼저 검토합니다.

자세한 내용은 [개발 문서 색인](dev-docs/README.md), [아키텍처](dev-docs/01-architecture.md), [업무 흐름](dev-docs/02-product-workflows.md), [실행·운영](dev-docs/06-development-operations.md), [의존성](dev-docs/08-dependencies.md), [제품 설계](blueprint/README.md)를 참고하세요.
