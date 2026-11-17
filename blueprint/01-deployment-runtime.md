# 배포 및 실행

PreM 통합 제품·기술 설계서 v2.0. 원문 **2장**을 수록한다. [문서 색인](README.md)

## 2.1 실행 명령

사용자가 지정해야 하는 필수 실행 옵션은 데이터 저장 경로 하나뿐이다.

```sh
./PreM --data-storage-path /data/PreM
```

제품명과 실행 파일명은 `PreM`다. 최초 실행, 일반 실행, 업데이트 후 실행 모두 같은 명령을 사용한다.

추가 설정 파일 작성, 수동 DB 생성, 폴더 생성, OCR 모델 설치, 프론트엔드 빌드는 필요하지 않다.

### 최초 실행 자동 처리

```text
실행 인자 파싱
    ↓
데이터 저장 경로 확인
    ↓
경로가 없으면 자동 생성
    ↓
디렉터리·읽기·쓰기 권한 확인
    ↓
스토리지 디렉터리 초기화
    ↓
기존 SQLite 존재 여부 확인
    ├─ 없음 → DB 생성 및 초기 Migration
    └─ 있음 → DB 버전 검증 및 필요한 Migration
    ↓
필수 런타임·OCR 모델 검사
    ↓
내부 Scheduler 및 Worker 초기화
    ↓
Rust HTTP Server 시작
    ↓
/home 제공
```

### 저장 경로 검증 규칙

| 상황 | 처리 |
| --- | --- |
| 지정된 경로가 없음 | 상위 경로에 권한이 있다면 자동 생성 |
| 경로가 정상적인 디렉터리 | 기존 데이터 유지 후 검증 |
| 파일을 경로로 지정 | 오류 출력 후 실행 중단 |
| 쓰기 권한 없음 | 오류 출력 후 실행 중단 |
| 공간 부족 | 최소 공간 정책 확인 후 실행 중단 |
| 상대 경로 지정 | 잘못된 인자로 처리, 절대 경로 요구 |
| DB가 존재하지 않음 | 신규 DB 생성 |
| 이전 버전 DB가 존재 | 백업 후 Migration |
| 현재 실행 파일보다 새로운 DB | 호환되지 않는 버전으로 판단하고 실행 중단 |
| DB 무결성 오류 | 자동 초기화 금지, 복구 필요 상태로 중단 |
| 동일 저장소로 다른 인스턴스 실행 | 인스턴스 잠금 충돌로 실행 중단 |
| 지정 스토리지가 미마운트 상태 | 예상 저장소 검증 정책에 따라 실행 중단 및 오류 기록 |

사용자가 입력한 저장 경로가 잘못되었을 때 임의의 다른 경로에 데이터를 저장해서는 안 된다.

디렉터리 생성 후에는 실제 파일 생성, 기록, `fsync`, 이름 변경, 삭제 테스트를 실행한다. 실행 중 필요한 파일은 해당 스토리지와 동일한 파일시스템의 임시 디렉터리에서 생성하여 원자적으로 최종 경로에 반영한다.

저장 경로의 영구 볼륨 여부는 회사 인프라 구성을 통해 보장받아야 한다. 단순한 쓰기 테스트만으로 Pod 재생성 후 데이터 영속성을 보장할 수는 없다. 최소 공간 기준과 예상 저장소 식별 방식의 구체적인 값은 별도 확정 대상이다.

## 2.2 선택 환경변수

기본 실행에는 환경변수가 필요하지 않다. Reference와 Template Storage는 개별 경로를 환경변수로 지정할 수 있어야 한다.

```sh
APP_REFERENCE_STORAGE_PATH=/mnt/company/references
APP_TEMPLATE_STORAGE_PATH=/mnt/company/templates
```

미설정 시 기본 경로는 다음과 같다.

```text
<data-storage-path>/libraries/references
<data-storage-path>/libraries/templates
```

| 환경변수 | 역할 | 기본 동작 |
| --- | --- | --- |
| `APP_REFERENCE_STORAGE_PATH` | 레퍼런스 저장 루트 | 데이터 경로 하위 사용 |
| `APP_TEMPLATE_STORAGE_PATH` | 템플릿 저장 루트 | 데이터 경로 하위 사용 |
| `APP_BLOB_STORAGE_PATH` | 공통 파일 Blob 저장 루트 | 데이터 경로 하위 사용 |
| `APP_LISTEN_ADDRESS` | 서버 바인딩 주소 | `0.0.0.0` |
| `APP_PORT` | HTTP 포트 | `8000` |
| `APP_LOG_LEVEL` | 로그 수준 | `info` |
| `APP_SECRET_KEY_FILE` | 별도 암호화 키 파일 | 미지정 시 데이터 경로에 생성 |

LLM Provider 설정은 환경변수로 주입하지 않고 [Admin UI](06-llm-admin.md)에서 관리한다.

스토리지 경로처럼 프로세스 시작 시 결정되는 설정은 재시작을 통해 반영한다. LLM Provider 및 모델 라우팅 변경은 서버 재시작 없이 반영한다.

## 2.3 배포 패키지

단일 배포본은 동일한 빌드에서 생성된 실행 파일과 필수 런타임 자산을 포함하는 패키지다.

```text
release/
├── PreM
├── runtime/
│   ├── libreoffice/
│   ├── h2orestart/
│   ├── java/
│   ├── python/
│   ├── ppt-master/
│   ├── node/
│   ├── kordoc/
│   │   └── models/
│   ├── pdfium/
│   └── fonts/
├── licenses/
└── manifest.json
```

- Rust 실행 파일은 실행 파일 위치를 기준으로 번들된 도구를 탐색한다.
- React 빌드 결과는 Rust 실행 파일에 정적 리소스로 포함한다.
- PPT Master, LibreOffice 등 외부 실행 도구는 런타임에 설치하지 않는다. 배포본의 바이너리와 라이브러리를 사용한다.
- 도구가 쓰기 가능한 프로필이나 작업 디렉터리를 요구하면 프로그램 설치 경로 대신 데이터 저장 경로 내부를 사용한다.

단일 실행 명령은 런타임 자산이 없는 실행 파일 하나만 배포한다는 의미가 아니다. 서버 실행 파일과 필수 자산이 함께 제공되는 단일 릴리스 패키지다.

## 2.4 데이터 디렉터리

```text
/data/PreM/
├── db/
│   └── app.sqlite
├── config/
│   └── secret.key
├── blobs/
│   └── sha256/
├── projects/
│   └── {project_id}/
│       └── workspace/
├── libraries/
│   ├── references/
│   └── templates/
├── work/
│   └── {workflow_run_id}/
├── tmp/
├── logs/
└── backups/
```

원본·생성 파일의 실제 바이트는 공통 [Blob Store](05-data-storage.md)에서 관리한다. 프로젝트와 라이브러리 디렉터리는 작업 공간, 추출 캐시, 인덱스, 임시 산출물을 관리한다.

Reference와 Template은 서로 독립적인 논리적 자산 저장소를 갖지만 파일 내용이 동일하면 공통 Blob을 참조한다. Blob 루트를 별도 경로로 지정한 경우에도 임시 저장과 최종 반영은 그 Blob 스토리지와 동일한 파일시스템에서 처리한다.

업데이트·Migration·백업·복구 절차는 [호환성·운영·개발 검증](09-operations-delivery.md)을 따른다. 작업 동시성과 SQLite 실행 설정은 [Workflow와 동시성](04-workflow-engine.md)에 정의한다.

## 로컬 오픈소스의 빌드·배포 포함 기준

Rust 라이브러리는 제품 빌드에, Uppy/shadcn/PDF.js 같은 브라우저 의존성은 Vite 정적 자산에, 문서 엔진과 Python/Node/Java·native libraries·모델·폰트는 `runtime/`에 포함한다. 빌드 환경에서 확보한 artifact를 제품 시작 때 설치하거나 다시 받지 않는다. 기본 app data와 도구의 쓰기 작업은 저장소 루트의 `./data/` 또는 명시적으로 검증한 저장 경로만 사용한다.

외부 엔진은 대상 Linux OS/CPU 및 동적 라이브러리 ABI에 맞춰 고정한다. manifest는 source URL·version/tag/commit·SHA-256·license/notice·native dependency·모델·실행 entry point를 포함한다. 모델 패킹 옵션의 이름만으로 전체 모델 포함을 가정하지 않고 실제 활성 프로필에 필요한 파일을 검증한다. 배포본 검사는 시스템 도구와 네트워크가 없는 환경에서 수행한다.

일부 패키지가 MIT여도 그 Python 요구사항 전체, native 라이브러리, 모델, 폰트가 같은 라이선스인 것은 아니다. H2Orestart의 GPLv3, LibreOffice의 MPL 및 전이 고지, PPT Master의 선택적 PyMuPDF 등은 팀 내부의 실제 설치·수정·네트워크 이용 형태에 맞게 검토한다. GPL/AGPL이라는 이유만으로 제외하지 않으며 외부 고객 재배포는 현재 전제하지 않는다. 정확한 후보와 보류 조건은 [의존성 목록](../dev-docs/08-dependencies.md)을 따른다. 이 절은 릴리스 수용 기준이며 현재 번들 제작이 완료됐다는 뜻이 아니다.

이 문서의 배포 패키지는 우리 팀 서버용이다. 현재 대상 환경의 재현 가능한 설치·백업·업데이트에 집중하며 고객용 다중 플랫폼 지원이나 상용 라이선스 관리 계층은 만들지 않는다.

## 사용자 경험 적용 범위

배포 명령·저장 경로·런타임 검사 정보는 운영 담당자 문서에 둔다. 일반 사용자에게 환경변수·DB Migration·모델 설치 작업을 요구하지 않는다. 공통 기준은 [일반 사무직을 위한 사용자 경험 계약](07-ui-design.md#일반-사무직을-위한-사용자-경험-계약)을 따른다.

### Admin 시작 토큰

서버 실행마다 256비트 난수 Admin 토큰을 생성하고 시작 CLI에 한 번 출력한다. 별도 필수 실행 옵션은 추가하지 않는다. 이 토큰은 메모리에만 보관하며 재시작하면 바뀐다. Admin 화면과 모든 Admin API는 토큰을 요구하고, 일반 공유 프로젝트·Studio·Space에는 사용자 로그인을 추가하지 않는다. 리다이렉트한 시작 출력은 비밀 정보를 포함하므로 운영자가 보호한다.

Admin 일반 설정의 토큰 변경은 현재 서버 실행에만 적용한다. 서버를 재시작하면 항상 새 난수 토큰을 CLI에 출력하고 초기 진입 순서를 다시 따른다. 변경한 토큰을 DB/파일에서 복원하거나 이전 토큰을 우회 경로로 허용하지 않는다.


## 날짜 버전 릴리스 패키지

태그는 `vYYYYMMDD`다. Release workflow는 macOS arm64, Ubuntu 24.04 arm64/amd64 네이티브 runner에서 번들 런타임을 설치하고 빌드한다. `package-release.py`가 실행 파일·Node·Python·Kordoc·PPT Master·한국어 OCR 모델·한국어 폰트와 라이선스·파일별 해시를 묶는다. 개발 의존성과 앱 데이터는 배포하지 않는다.

`verify-release.py`는 다른 경로에 풀고 PATH에서 개발 도구를 제거한 환경에서 OCR 모델·Sharp·Python 패키지 로딩, 스캔 PDF/Office/HWP 추출, PPTX 생성·PNG 렌더링, HTTP 시작과 재시작을 검증한다. Linux는 libstdc++·libgcc·libatomic과 시스템 인증서가 없을 때 사용할 공개 CA 인증서를 포함하며 `verify-release-linux.sh`로 추가 패키지가 없는 Ubuntu 24.04를 네트워크 없이 검사한다. 세 archive와 SHA-256 파일이 draft에 모두 도착한 뒤 릴리스를 게시한다. Linux OS 요구사항은 glibc 2.39 이상, macOS는 14 이상이다. libc/OS 프레임워크와 외부 LLM 추론 서비스는 호스트 책임이다. 파일 이름은 `PreM-vYYYYMMDD-{linux-arm64,linux-amd64,macos-arm64}.tar.gz`다.

PDF 해석에 필요한 Kordoc 내장 WASM과 제3자 고지도 문서 런타임의 일부다. manifest는 WASM 파일을 포함해 검증하며, OCR 모델은 설치 번들을 읽어 앱 전용의 쓰기 가능한 캐시에 준비한다. 패키지 검증에서도 설치 경로에 쓰는 대신 독립 OCR 캐시를 사용한다.
