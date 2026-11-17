# 개발·실행·장애 대응

## 개발 환경

| 항목        | 저장소 설정                                  | 기준 파일                                                          |
| ----------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Rust        | 1.99.1, rustfmt·Clippy                       | [rust-toolchain.toml](../rust-toolchain.toml)                      |
| Node.js     | 26.13.0 기준, engines는 26.13.0 이상 27 미만 | [.node-version](../.node-version), [package.json](../package.json) |
| pnpm        | 12.16.1                                      | [package.json](../package.json)                                    |
| 보조 실행   | Bash, Python 3                               | [scripts/](../scripts/), [mock/helpers/](../mock/helpers/)         |
| 브라우저 QA | 설치된 Chrome/Chromium, Puppeteer Core       | [browser.cjs](../mock/helpers/browser.cjs)                         |

개발 프로세스 실행 스크립트는 POSIX 프로세스 그룹을 사용한다. Windows의 동일 동작은 검증 범위에 포함하지 않는다. 잠금 파일은 `Cargo.lock`과 `pnpm-lock.yaml`이다.

## 목업 실행

저장소 루트에서 실행한다.

```sh
python3 mock/helpers/serve.py
```

접속 주소는 `http://127.0.0.1:5174/`다. 편집기는 `http://127.0.0.1:5174/#view=editor&project=platform&deck=deck1`로 연다. 포트는 `--port`로 바꿀 수 있다.

목업 실행에는 Rust·Vite·DB가 필요하지 않다. `mock/index.html`을 브라우저에서 직접 열어도 동작한다. 정적 서버는 loopback에만 바인딩하고 자산 응답에 `no-store`를 설정한다.

## 제품 개발 서버

```sh
./scripts/setup.sh
pnpm runtime:install
pnpm dev
```

설치 스크립트는 잠금 파일 기준 pnpm 설치와 Cargo 의존성 조회, 고정 개발 CLI·LLVM 구성요소 설치를 수행한다. rustup이 필요하며 CLI 버전은 `scripts/dev-tools.json`을 따른다. 이 설치 단계에는 네트워크가 필요할 수 있다.

| 명령                | 실행 결과                                     |
| ------------------- | --------------------------------------------- |
| `pnpm dev`          | Rust `127.0.0.1:8000` + Vite `127.0.0.1:5173` |
| `pnpm dev:backend`  | Rust만 실행                                   |
| `pnpm dev:frontend` | Vite만 실행, Health 조회에는 별도 백엔드 필요 |
| `pnpm dev sandbox`  | 개발 데이터 위치를 `./data/sandbox/`로 분리   |

React 접속 주소는 `http://127.0.0.1:5173/home/`이며 공유 프로젝트 목록이 열린다. 연결 상태는 `/home/system`에서 확인한다. Vite는 `/api`와 `/healthz`를 백엔드로 프록시한다. 프록시 설정이 업무 API 구현을 의미하지 않는다.

`pnpm dev`는 하위 프로세스를 함께 관리한다. 종료 신호를 보내고 남은 프로세스에 5초 후 강제 종료를 시도한다. 데이터 폴더를 분리해도 기본 포트는 같으므로 명명된 데이터 경로만으로 여러 개발 서버를 동시에 실행할 수는 없다.

## 저장 경로와 시작 동작

개발 실행의 기본 저장소는 **저장소 루트의 `./data/`**다. 개발 스크립트는 이를 절대 경로로 변환하고 상위 경로 이탈을 문자열 경로 계산으로 거부한다. 이 검사가 심볼릭 링크를 포함한 파일시스템 보안 검증을 제공하는 것은 아니다.

현재 백엔드 시작 순서:

1. 실행 인자와 로그 수준을 검증한다.
2. 지정한 절대 저장 경로를 생성한다.
3. `.instance.lock`을 열고 비차단 독점 잠금을 얻는다.
4. 필요한 저장 폴더를 생성하고 심볼릭 링크·디렉터리 유형을 검사한다.
5. tmp에서 파일 생성·쓰기·fsync·rename·삭제를 시험한다.
6. 기존 DB를 읽기 전용으로 열어 무결성·identity·Migration checksum·버전을 확인한다. 필요한 Migration 전에 일관 백업을 만든다.
7. SQLite WAL·FK·busy timeout·FULL synchronous와 embedded Migration을 적용하고 무결성·필수 schema를 검사한다.
8. async-sqlite의 SQLite 소유 스레드를 시작하고 HTTP 소켓을 바인딩한다.

이미 존재하는 데이터는 초기화하지 않는다. 잠금을 얻지 못하면 시작을 중단한다. 잠금 파일의 존재 자체는 활성 프로세스의 증거가 아니며, 살아 있는 인스턴스가 사용하는 잠금 파일을 삭제해서는 안 된다.

현재 저장 루트와 생성 자식 폴더, 잠금·DB 파일의 심볼릭 링크를 거부하고 실제 쓰기 시험과 DB 검사를 수행한다. CLI 경로의 모든 상위 디렉터리에 대한 완전한 샌드박스, 최소 가용 공간 정책, 영구 마운트 식별은 아직 없다. 실행 성공만으로 영구 볼륨·정기 백업을 보장하지 않는다.

## 빌드와 실행

```sh
pnpm build
./target/release/PreM --data-storage-path "$PWD/data" --listen-address 127.0.0.1
```

빌드는 토큰 동기화를 검사하고 React Compiler를 적용한 React를 빌드한 뒤 `embedded-ui` feature로 Rust 실행 파일에 포함한다. 실행 시 프론트엔드를 다시 빌드하지 않는다.

일반 `cargo run`은 기본 feature를 사용하므로 `/home`에서 503과 Vite 안내를 제공한다. 제품 빌드에 목업, OCR 모델, Office·PPT 런타임이 포함되는 것은 아니다. 현재 `runtime/`은 필요한 자산을 모두 갖춘 배포 패키지로 검증되지 않았다.

## 현재 지원 설정

| CLI                   | 환경변수             | 기본값         |
| --------------------- | -------------------- | -------------- |
| `--data-storage-path` | 없음                 | 필수 절대 경로 |
| `--listen-address`    | `APP_LISTEN_ADDRESS` | `0.0.0.0`      |
| `--port`              | `APP_PORT`           | `8000`         |
| `--log-level`         | `APP_LOG_LEVEL`      | `info`         |

직접 바이너리를 실행하면 기본 바인딩은 모든 인터페이스다. 개발 실행 스크립트는 loopback으로 고정한다. Blueprint의 별도 Reference·Template·Blob 저장 경로 환경변수는 현재 서버에서 구현되지 않았다. 암호화 키 파일은 `--secret-key-file` 또는 `APP_SECRET_KEY_FILE`로 지정할 수 있다.

## 진단과 대응

| 증상                    | 확인 사항                        | 대응                                                   |
| ----------------------- | -------------------------------- | ------------------------------------------------------ |
| `/home`이 503           | `embedded-ui` 없이 실행했는지    | Vite로 접속하거나 `pnpm build` 후 실행                 |
| `/api/v1/...`가 404     | 업무 API 미구현 여부             | [현재 HTTP 계약](04-data-api.md) 확인                  |
| 저장소 잠금 오류        | 같은 경로의 서버, 파일 잠금 지원 | 기존 서버를 정상 종료하거나 별도 개발 데이터 경로 사용 |
| 상대 저장 경로 오류     | 직접 실행 인자                   | `$PWD/data` 등 절대 경로 사용                          |
| 디렉터리 생성 실패      | 경로가 파일인지, 권한·부모 경로  | 지정 경로를 수정하고 원래 데이터 유지                  |
| 소켓 바인딩 실패        | 같은 포트를 사용하는 프로세스    | 기존 프로세스 종료 또는 직접 실행 포트 변경            |
| React 연결 실패         | 백엔드 시작 상태, 프록시 대상    | `/healthz` 확인; 초기 Cargo 빌드 완료 대기             |
| 목업 변경 내용 소실     | 새로고침·새 페이지 세션          | 정상적인 인메모리 동작; 필요한 구성은 JSON 내보내기    |
| 오래된 채팅 수정안 거부 | 요청 이후 deck 리비전 변경       | 현재 선택 범위에서 새 메시지 전송                      |
| 이미지 삽입 거부        | 형식·크기·해상도·리비전 변경     | 제한에 맞는 이미지 재선택                              |

로그는 tracing 표준 출력으로 기록한다. `logs/` 디렉터리를 만드는 것과 파일 로그·수집·보존 정책을 구현한 것은 다르다. Health 응답만으로 데이터 복구나 외부 런타임의 정상 상태를 판정하지 않는다.

## 파일 관리

`./data/`에는 앱 소유 데이터만 둔다. 캡처는 `mock/captures/`, 보조 소스는 `mock/helpers/`, 브라우저 프로필·임시 파일은 `mock/helpers/.artifacts/`를 사용한다. 제품 테스트는 `tests/.artifacts/`의 격리된 데이터를 사용한다.

기존 DB의 Migration 전 백업은 `backups/before-migration-{uuid}.sqlite`에 생성된다. 정기 전체 백업·복구 도구는 아직 없다. 운영 복구 절차와 DB·Blob 일관성은 [운영 수용 조건](07-quality-readiness.md)을 충족한 뒤 문서화·검증해야 한다.

## React Developer Tools 사용

공식 확장을 사용하는 브라우저에 설치한다: [Chrome](https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi), [Edge](https://microsoftedge.microsoft.com/addons/detail/react-developer-tools/gpphkfbcpidddadnkolkpfckpihlkkil), [Firefox](https://addons.mozilla.org/en-US/firefox/addon/react-devtools/). 저장소의 패키지 설치 명령은 브라우저 확장을 설치하지 않는다.

1. `pnpm dev`로 React 개발 서버를 실행한다.
2. `http://127.0.0.1:5173/home/`을 열고 브라우저 개발자 도구에서 Components·Profiler 탭을 확인한다.
3. Profiler 기록을 시작한 뒤 연결 확인 등 확인할 동작을 수행하고 기록을 종료한다.
4. commit별 렌더링 시간과 변경된 컴포넌트를 비교한다. 필요하면 React에 내장된 `<Profiler>`로 특정 트리의 시간을 측정한다.

`mock/`는 React 앱이 아니므로 이 확장의 컴포넌트 분석 대상이 아니다. 개발 모드·StrictMode·DevTools의 측정 비용이 있으므로 개발 기록만으로 운영 성능 향상을 단정하지 않는다. 브라우저 확장과 Profiler의 동작은 별도의 수동 검증 대상이며 CLI 품질 검사에 포함되지 않는다. [DevTools](https://react.dev/learn/react-developer-tools), [Profiler](https://react.dev/reference/react/Profiler)

손상된 DB, 더 새로운 `user_version`, 알 수 없는 테이블·Migration 이력은 자동 초기화하지 않고 시작을 거부한다. 보관 중인 DB를 삭제해서 오류를 우회하지 않는다. 생성 요청 키도 DB에 보관되므로 재시작 후 같은 요청을 재전송해도 프로젝트를 중복 생성하지 않는다.

## Space 저장·장애 처리

제품 Space의 검색은 `/home/space`, 등록·관리는 `/home/space/library`에서 사용한다. 원본은 설정된 데이터 루트의 `blobs/sha256/`에 저장한다. `.staging`도 같은 Blob 파일시스템에 두며 중단 후 재시작에서 소유 임시 파일만 제거한다. 업로드 실패 시 공개 오류·다시 시도·취소를 제공한다. 전송은 새로고침 후 자동 재개하지 않으며 파일을 다시 선택한다. 파일 확정 후 DB 등록에 실패한 고아 Blob은 즉시 삭제하지 않고 시작 시 보존기간·참조·백업 검사 정책에 따라 정리한다.

실제 원본과 SQLite를 함께 백업해야 한다. 현재 자동 백업은 Migration 전 DB 백업이며 전체 Blob 일관 스냅샷·복구 자동화는 아직 없다. 업로드 형식 검사는 제한된 구조 검사다. 문서 추출·OCR은 번들 도구와 제한된 자식 프로세스를 사용하지만 완전한 악성 파일 검사나 운영 격리 검증의 완료를 의미하지 않는다.

## LM Studio 연결과 키 운영

1. LM Studio의 서버를 켜고 모델을 준비한다. PreM Admin → 모델 연결 → LLM 탭에서 Provider와 Base URL을 지정하고 모델 목록을 조회해 선택·저장한다.
2. LM Studio Native의 주소는 `http://127.0.0.1:1234/api/v1` (명시적 호환 연결은 `http://127.0.0.1:1234/v1`), 모델 ID는 `ornith-1.5-35b-a3b`다. LM Studio 파일 메타데이터에서 Q4_K_M(35B A3B)을 확인했다. 양자화 이름을 API 모델 ID에 붙이지 않는다.
3. 모델 목록 조회 후 텍스트 응답을 테스트한다. 구조화 응답은 해당 API가 지원하는 경우에만 테스트한다. 초기 모델 로딩은 응답 제한 시간에 포함된다. LM Studio에서 인증을 켠 경우에만 API Key를 등록한다.
4. Pod 안의 127.0.0.1은 Pod 자신이므로 별도 PC의 LM Studio를 사용한다면 서버에서 도달 가능한 내부망 주소를 지정한다. 브라우저가 모델 서버에 직접 접속하지 않는다.

기본 키 파일은 `<data-storage-path>/config/secret.key`에 생성하는 32바이트 바이너리다. 내부 키는 symlink를 거부하고 Unix 권한 0600을 요구한다. 외부 Secret은 `APP_SECRET_KEY_FILE=/absolute/path/key` 또는 `--secret-key-file`로 주입할 수 있다. 외부 파일은 자동 생성하지 않는다. 키는 DB·Blob 백업과 함께 복원하되 별도 보호 저장소에 보관한다. 기본 키와 DB가 같은 저장소에 있는 구성은 전체 저장소 유출 방어가 아니다.

암호화된 설정이 있는데 키가 없거나 복호화가 실패하면 시작을 중단한다. 새 키로 덮어써서 복구하지 않는다. 자동 키 회전과 KMS 연동은 미구현이다. 지원되는 이전 저장소를 시작하면 일관된 DB 백업 후 필요한 V5·V6 Migration을 순차 적용한다.

실제 모델 수용 검사는 운영 데이터 대신 별도 QA 저장소를 사용한다. 외부 모델 호출이므로 기본 테스트에는 포함하지 않는다.

```sh
PREM_LIVE_LLM_PROTOCOL=lm_studio_native \
PREM_LIVE_LLM_URL=http://127.0.0.1:1234/api/v1 \
PREM_LIVE_LLM_MODEL=ornith-1.5-35b-a3b \
node tests/e2e/provider-live.cjs
```

네이티브 검사는 text만 실행한다. 명시적 호환 경로의 text/structured 검사는 PREM_LIVE_LLM_PROTOCOL=lm_studio 및 /v1 URL로 실행한다. 다른 클라우드 키는 Admin에서 입력하며 실제 자격증명 없는 계약 fixture 검사를 실서비스 수용 검사로 간주하지 않는다. V5 데이터의 V6 업그레이드는 백업 뒤 실행되고 기존 설정·암호문·요청 이력을 유지한다.

## 문서 런타임 준비

개발 도구 uv·npm·tar를 사용할 수 있는 환경에서 `pnpm runtime:install`을 한 번 실행한다. Node·Python·Kordoc·OCR 모델·PPT Master는 `runtime/`에 설치한다. 이후 `pnpm build`와 `pnpm check`는 로컬 도구의 manifest를 갱신하며 패키지나 모델을 내려받지 않는다. 서버 실행도 다운로드를 수행하지 않는다.

`APP_DOCUMENT_RUNTIME_PATH`로 별도 패키지 경로를 지정할 수 있다. 도구 작업 디렉터리와 OCR 쓰기 캐시는 앱 저장 경로 내부에 생성된다. `tests/.artifacts/`는 통합 테스트 전용이며 `data/`에 QA 자료를 등록하지 않는다. 상세 도구 구성은 [runtime README](../runtime/README.md)를 따른다.

## 저장 공간 관리

PPT 추출 구성 파일은 개별 Blob으로 저장하고 레퍼런스·템플릿이 공통 결과를 참조한다. 내려받는 ZIP은 임시로 조립되며 영구 저장량에 더해지지 않는다. 기존 파일과 확정 버전은 자동 변환하거나 삭제하지 않는다.

시작 시 미참조 Blob을 관찰하고 7일이 지난 후보를 다음 시작에서 최대 1,000개 정리한다. 실행 중 정리는 없다. 앱 자체 `backups/`의 SQLite 스냅샷에 있는 파일도 보호하므로 백업을 유지하는 동안 공간이 바로 반환되지 않을 수 있다. 손상된 백업·알 수 없는 파일·WAL sidecar가 있으면 삭제를 생략하고 원인을 로그에 남긴다. 이 경우 임의로 백업이나 DB를 삭제해 통과시키지 말고 저장소 상태를 확인한다. 외부 백업은 DB와 필요한 Blob을 함께 스냅샷해야 한다.

## 과거 자료 검색 운영

Admin → Decision Model 연결에서 Decision 또는 구조화 출력 가능한 LLM 연결을 선택한다. 문서 목차 판정과 같은 공통 연결을 사용한다. 연결의 동시성·대기열·timeout이 검색에도 적용되며 저장은 이미 완료된 검색을 재실행하지 않는다. Studio → 과거 자료 찾기에서 명시적으로 시작한다.

검색은 DB에 대기/진행/부분 완료 상태를 남긴다. 실패 시 완료 후보를 유지하고 ‘이어서 찾기’가 미완료 후보만 처리한다. 원본·가이드 변경 후 새 검색은 새 snapshot을 사용하며 과거 실행을 바꾸지 않는다. 모델 설정을 바꾼 뒤 새 모델을 적용하려면 새 검색을 실행한다. 기존 실행의 재개는 최초 설정을 유지한다.

LM Studio D3에서 engine_failure가 발생하면 일반 화면의 오류를 ‘관련 없음’으로 해석하지 않는다. 운영 로그의 non-causal n_ubatch assertion과 context-length 초과를 구분해 모델 런타임을 점검한다. 앱 요청 동시성은 엔진 내부 micro-batch 크기를 변경하지 않으며, 원문이나 기존 결과를 삭제해 해결하지 않는다.

## Admin 토큰 확인

서버 실행 명령은 그대로 사용한다. HTTP 서버 시작에 성공하면 터미널에 `PreM Admin token: <64자리 임의 토큰>`을 한 번 표시한다. Admin 입력창에 복사해서 붙여넣는다. 토큰을 잃어버린 경우 서버를 다시 시작해 새 토큰을 확인한다. 다른 프로젝트 데이터와 Provider 설정 암호화 키는 재생성하지 않는다.

토큰은 구조화 로깅·DB·설정 파일에 기록하지 않는다. 단, 운영자가 CLI 출력을 파일/컨테이너 로그로 리다이렉트하면 시작 출력에도 비밀 정보가 포함되므로 접근을 제한해야 한다. localhost 외 운영 연결은 회사 Ingress의 HTTPS를 사용한다. 비밀 토큰을 URL 인자나 환경변수 기본값으로 제공하는 경로는 없다.

Admin의 일반 설정에서 토큰을 변경할 수 있다. 변경값은 현재 프로세스의 메모리에만 적용된다. 재시작하면 변경값을 복원하지 않고 항상 새로운 CLI 임의 토큰을 발급한다. 토큰 변경이나 재시작이 프로젝트·원본 파일·Provider 설정을 초기화하는 동작은 아니다.

## 날짜 버전 릴리스 패키지

태그는 `vYYYYMMDD`다. Release workflow는 macOS arm64, Ubuntu 24.04 arm64/amd64 네이티브 runner에서 번들 런타임을 설치하고 빌드한다. `package-release.py`가 실행 파일·Node·Python·Kordoc·PPT Master·한국어 OCR 모델·한국어 폰트와 라이선스·파일별 해시를 묶는다. 개발 의존성과 앱 데이터는 배포하지 않는다.

`verify-release.py`는 다른 경로에 풀고 PATH에서 개발 도구를 제거한 환경에서 OCR 모델·Sharp·Python 패키지 로딩, 스캔 PDF/Office/HWP 추출, PPTX 생성·PNG 렌더링, HTTP 시작과 재시작을 검증한다. Linux는 libstdc++·libgcc·libatomic과 시스템 인증서가 없을 때 사용할 공개 CA 인증서를 포함하며 `verify-release-linux.sh`로 추가 패키지가 없는 Ubuntu 24.04를 네트워크 없이 검사한다. 세 archive와 SHA-256 파일이 draft에 모두 도착한 뒤 릴리스를 게시한다. Linux OS 요구사항은 glibc 2.39 이상, macOS는 14 이상이다. libc/OS 프레임워크와 외부 LLM 추론 서비스는 호스트 책임이다. 파일 이름은 `PreM-vYYYYMMDD-{linux-arm64,linux-amd64,macos-arm64}.tar.gz`다.
