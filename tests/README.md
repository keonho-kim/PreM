# 검증 디렉터리

| 경로                                | 실제 소유                                                      |
| ----------------------------------- | -------------------------------------------------------------- |
| `backend/tests/` (저장소 루트 기준) | Rust 도메인·HTTP·SQLite·외부 도구 통합 및 migration/복구       |
| `frontend/src/**/*.test.ts(x)`      | React 행동·상태·라우팅·폼·접근성 계약                          |
| `tests/fixtures/`                   | 공개/합성 입력과 사람이 작성한 기대값                          |
| `tests/helpers/`                    | 브라우저 어댑터·추출/백업 검사·fixture 도구                    |
| `tests/e2e/`                        | 실제 컴파일 서버와 브라우저 여정; suites.json이 실행 목록 소유 |
| `tests/.artifacts/`                 | 격리 DB·브라우저 프로필·보고서·캡처·임시 패키지                |

`pnpm check:core`가 로컬과 네이티브 릴리스 CI의 공통 게이트다. `pnpm test:e2e`는 모든 여정을 순서대로 실행하고 실패 후에도 나머지 결과를 모은다. 특정 검사만 재실행하려면 `pnpm test:e2e projects backup-restore`처럼 이름을 전달한다.

문서 준비에 필요한 공통 판정 연결은 테스트가 명시적으로 설정한다. `configure-documents.cjs`는 실제 문서 파서를 그대로 사용하면서 분류만 로컬 합성 응답으로 고정한다. 모델 미설정 gate는 document-processing 여정과 Rust 해당 테스트가 별도로 검증한다. 합성 테스트는 실모델의 작성 품질이나 업무 문서 전체 정확도를 보장하지 않는다.

브라우저 도구는 `tests/.artifacts/browser-tools/`에 설치하며 버전은 `scripts/runtime-versions.json`에서 읽는다. Chrome 경로는 `CHROME_PATH`로 지정할 수 있다. 실제 `data/`에 QA 자료를 만들지 않는다.

브라우저 도구 설치 후 `node scripts/install-test-browser.mjs`는 고정 Puppeteer가 요구하는 Chrome for Testing을 `tests/.artifacts/browser-tools/`에 준비한다. 브라우저 어댑터는 명시한 `CHROME_PATH`, 이 고정 브라우저, 시스템 Chrome 순으로 선택한다. `helpers/interactions.cjs`는 화면 갱신과 실제 클릭의 완료 조건을 공유한다.
