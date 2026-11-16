# 검증 디렉터리

| 경로                 | 용도                               |
| -------------------- | ---------------------------------- |
| `fixtures/`          | 입력 문서·기준 산출물              |
| `integration/`       | 서비스·스토리지 통합 검증          |
| `provider-contract/` | LLM Provider별 계약 검증           |
| `workflow/`          | 체크포인트·재시도·복구 검증        |
| `migration/`         | 이전 릴리스 데이터 업그레이드 검증 |
| `e2e/`               | 사용자 흐름 검증                   |

현재 HTTP 통합 테스트는 `backend/tests/http.rs`, 실제 실행 파일 Smoke 검증은 `scripts/smoke_test.py`에 있다. 기반 패키지의 SQLite·Migration·Schema·SSE·취소 조합은 `backend/tests/dependency_contracts.rs`에서 검사한다. 프론트엔드는 `frontend/src/pages/home-page.test.tsx`에서 연결 상태의 오류·재시도·요청 취소를 검사한다. 추가 테스트는 기능별 `*.test.ts(x)`로 둔다. 의존성 구성과 검증 경계는 [의존성 명세](../dev-docs/08-dependencies.md)를 따른다.

공유 프로젝트의 HTTP·동시 변경·재시작은 `backend/tests/projects.rs`, DB 시작·보존은 `backend/tests/database_startup.rs`에서 검사한다. 실제 브라우저의 두 접속자 공유 흐름은 `pnpm build` 후 `pnpm test:e2e`로 검사한다. E2E 데이터는 `tests/.artifacts/`에 격리하고 화면 이미지는 `mock/captures/folio/`에 저장한다.
