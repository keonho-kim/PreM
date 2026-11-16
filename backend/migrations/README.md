# SQLite Migration

`V1__projects.sql`은 실제 공유 프로젝트와 생성 요청 키를 저장한다. `adapters/sqlite/migrations.rs`가 refinery로 실행 파일에 포함하고 시작 시 검사·적용한다.

배포한 SQL은 수정하지 않는다. 새 기능의 schema는 다음 번호의 Migration으로 추가한다. 기존 데이터에는 적용 전에 일관 백업을 만들고, 더 새로운 DB·checksum 불일치·손상 파일은 자동 초기화하지 않는다. 테스트용 테이블은 제품 Migration에 넣지 않는다.

`V2__project_home.sql`은 종료일, 논리 삭제 시각, 생성 요청의 종료일과 Home 조회 인덱스를 추가한다. V1 프로젝트의 종료일은 null로 유지한다.

`V3__project_due_date.sql`은 마감일 단일 값의 이름을 `due_date`/`original_due_date`로 정리한다. V2의 값과 요청 기록을 그대로 이관하며 프로젝트 시작일은 만들지 않는다.
