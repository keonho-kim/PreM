# 개발·실행·장애 대응

현재 SQLite 마이그레이션은 이전 V36 스키마를 기준으로 한 새 V1에서 시작한다. 기존 설치의 버전별 전환 절차는 [마이그레이션 안내](../backend/migrations/README.md)에 있다.

## 개발 환경과 명령

`scripts/runtime/`은 문서 실행기 설치와 준비, `scripts/quality/`는 소스·도구·의존성 검사, `scripts/test/`는 브라우저 테스트·커버리지·스모크 검사, `scripts/release/`는 번들 생성과 검증을 담당한다. 개발 명령은 저장소 루트에서 아래와 같이 실행한다.

버전은 `.node-version`, `rust-toolchain.toml`, `package.json`, `scripts/runtime/versions.json`, `scripts/quality/dev-tools.json`이 소유한다. `./scripts/setup.sh`는 의존성·개발 도구를 준비하고 `pnpm runtime:install`은 로컬 문서 실행기를 설치한다. 앱 실행 중 설치는 하지 않는다.

| 명령                            | 동작                                           |
| ------------------------------- | ---------------------------------------------- |
| `pnpm dev`                      | Rust와 Vite, 기본 `data/`                      |
| `pnpm dev sandbox`              | 이름 있는 별도 개발 데이터 경로                |
| `pnpm build`                    | frontend를 포함한 `target/release/PreM`        |
| `pnpm check:core`               | 전체 개발 품질 검증                            |
| `pnpm check`                    | 공통 검증 + Rust 개발 도구/의존성 정책         |
| `pnpm test:e2e`                 | 전체 실제 서버·브라우저 여정, 실패를 모아 보고 |
| `pnpm audit:parsing`            | 고정 문서 corpus의 추출 품질 검사              |
| `pnpm check:versions vYYYYMMDD` | 태그와 소스 버전 일치 확인                     |

Vite는 `127.0.0.1:5173/home/`, API는 `127.0.0.1:8000`이다. Rust 변경 후 개발 서버를 재시작한다. 릴리스 실행은 다음과 같다.

```sh
./PreM --data-storage-path /absolute/path/to/data --listen-address 127.0.0.1 --port 8000
```

`--port`의 기본값은 8000이다. `APP_PORT`, `APP_LISTEN_ADDRESS`, `APP_LOG_LEVEL`, `APP_SECRET_KEY_FILE`을 지원하며 CLI 인자가 우선한다. `.env`를 자동으로 읽지 않는다. 외부 접속·HTTPS는 회사 배포 인프라에서 구성한다.

## 저장 경로와 시작 동작

데이터는 지정한 루트 아래의 `db/`, `blobs/`, `config/`, `projects/`, `libraries/`, `backups/`가 소유한다. 작업·캐시는 `work/`, `tmp/`, `logs/`, `config/kordoc-cache/` 등에 둔다. QA는 `tests/.artifacts/`, 브라우저 어댑터는 `tests/helpers/browser.cjs`이며 실제 데이터에 테스트를 심지 않는다.

프로세스는 `.instance.lock`을 독점한 뒤 저장 디렉터리와 DB를 검사한다. 잠금 오류가 나면 같은 저장소를 사용하는 실행을 먼저 종료한다. 잠금 파일을 삭제해서 우회하지 않는다. 스키마가 앱보다 새로우면 시작을 거부하고 migration 전 DB 백업을 만든다. 이 자동 DB 백업은 전체 파일 백업과 구분한다.

## Admin과 모델 연결

서버 시작 터미널의 `PreM Admin token:` 값을 Admin 입력창에 넣는다. 토큰은 프로세스 메모리에만 있고 재시작하면 바뀐다. 일반 사용자 계정은 없다. Admin의 일반 설정에서 변경한 토큰도 재시작 후 유지하지 않는다.

모델 주소·자격 증명은 저장 시 암호화되고 설정 버전이 생긴다. 기본 키는 `config/secret.key`이며 외부 키 파일을 지정할 수도 있다. 암호화된 설정이 있는데 키가 없거나 맞지 않으면 시작을 거부한다. 키를 새로 만들어 기존 설정을 복구할 수는 없다.

문서 처리·자료 찾기는 Decision Model 연결에서 지정한 공통 판정 연결을 사용한다. 미설정이면 문서 준비는 대기하고 검색 실행은 설정 확인이 필요하다. 모델을 바꿔도 완료 결과를 자동 재생성하지 않으며 진행 작업은 고정한 설정을 사용한다.

## 오프라인 백업과 복원

릴리스에는 시스템 Python 설치 없이 실행하는 `PreM-maintenance`가 포함된다. 개발 checkout에서는 같은 기능을 `python3 scripts/storage-backup.py`로 실행한다.

1. PreM를 정상 종료한다. 도구는 실행 중 저장소의 잠금을 획득하지 못하면 거부한다.
2. 저장 루트 밖에 새 아카이브를 만든다. DB는 SQLite backup API로 일관된 snapshot을 만들고 Blob·프로젝트·라이브러리·암호화 키·기존 migration 백업을 함께 보관한다.
3. 다른 **새 저장 경로**에 복원한다. 기존 경로·파일은 덮어쓰지 않는다.
4. 복원 경로로 PreM를 실행해 프로젝트·원본 다운로드·모델 설정을 확인한 뒤 운영 경로를 전환한다. 이전 저장소와 아카이브는 검증 완료까지 보관한다.

```sh
./PreM-maintenance backup \
  --data-storage-path /srv/prem/data \
  --output /srv/backups/prem-snapshot.tar.gz

./PreM-maintenance restore \
  --archive /srv/backups/prem-snapshot.tar.gz \
  --data-storage-path /srv/prem/restored-data

./PreM --data-storage-path /srv/prem/restored-data --port 8000
```

백업 출력의 부모 폴더와 복원 대상의 부모 폴더는 미리 만들어 둔다. 외부 암호화 키를 사용하는 경우 backup에 `--secret-key-file /absolute/path/to/key`를 전달해야 한다. 해당 키는 아카이브의 `config/secret.key`로 보관되므로 복원 후 기본 키 경로로 실행할 수 있다. 아카이브에는 복호화에 필요한 키가 있으므로 접근을 제한한다; 파일 권한은 0600이다.

`work/`, `tmp/`, `logs/`와 재생성 가능한 OCR/폰트 캐시는 제외한다. 파일별 크기·SHA-256, SQLite 무결성·외래 키를 검사하며 링크·경로 탈출·추가/누락 파일을 거부한다. 아카이브는 최대 100000개 파일이며 이는 온라인 백업/정기 실행 서비스가 아니다. 호스트 장애 대비 보관 위치·주기·보존 기간은 운영자가 정한다.

## 로컬 패키징

`pnpm build` 후 현재 호스트용 번들이 필요하면 `pnpm release:package vYYYYMMDD`를 실행한다. 태그 인자는 소스 제품 버전과 일치해야 한다. `pnpm release:verify <archive>`는 다른 경로에 압축을 풀고 포함된 런타임으로 실행·백업·복원을 검사한다. Linux 최소 환경 검증에는 `scripts/release/verify-linux.sh`를 사용한다.

## 장애 대응

| 증상              | 확인/복구                                                          |
| ----------------- | ------------------------------------------------------------------ |
| 저장소 잠금 실패  | 같은 저장소의 기존 서버 종료; 잠금 파일 삭제 금지                  |
| 포트 충돌         | `--port`로 비어 있는 포트 지정                                     |
| 문서 설정 대기    | 공통 판정 연결 선택 후 상태 확인                                   |
| 추출/모델 실패    | 작업 오류 확인, 모델/도구 상태 수정 후 명시적 재시도               |
| 새 DB 스키마 거부 | 더 최신 앱 사용 또는 이전 앱과 일치하는 전체 백업을 새 경로에 복원 |
| 암호화 키 오류    | 원래 키를 포함한 일관된 백업 복원; 키 재생성 금지                  |
| 공유 변경 충돌    | 저장된 최신 버전 확인 후 보존된 초안 검토·재저장                   |

`pnpm check:structure`는 350줄과 프론트엔드 의존 경계를 검사한다. runtime/data/build 결과는 Git에 넣지 않는다. React DevTools/Profiler는 개발용이며 릴리스에 디버그 스크립트를 삽입하지 않는다.
