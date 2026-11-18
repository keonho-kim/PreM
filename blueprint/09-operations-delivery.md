# 호환성·운영·개발 검증

PreM 통합 제품·기술 설계서 v2.0. 원문 **11장, 13장, 14장, 16장**을 수록한다. [문서 색인](README.md)

## 11.1 SQLite Migration

refinery를 사용하여 Migration을 Rust 실행 파일에 포함한다.

현재 기준은 이전 V36과 같은 스키마의 `V1__baseline.sql`이다. V2부터 기준 스키마 위에 변경을 순서대로 추가한다. 배포한 파일의 내용과 번호는 유지한다. 기존 DB의 백업·전환 경로는 [SQLite 마이그레이션](../backend/migrations/README.md)을 따른다.

### 업데이트 정책

1. 서버 시작 전 기존 데이터 확인
2. 기존 DB 버전 및 체크섬 확인
3. 변경이 필요한 경우 일관성 있는 DB 백업 생성
4. 필요한 Migration 순차 실행
5. Foreign Key 및 무결성 검사
6. 신규 애플리케이션 스키마와 호환성 확인
7. 서비스 시작

Migration 실패 시 기존 데이터를 초기화하지 않는다.

일부 테이블 재구성이 필요하면 새 테이블 생성, 데이터 이관, 검증, 기존 테이블 전환을 트랜잭션 범위 내에서 수행한다. 현재 실행 파일보다 새로운 DB나 무결성 오류가 있는 DB는 [시작 검증](01-deployment-runtime.md)에 따라 실행을 중단한다.

## 11.2 하위호환성 범위

| 대상 | 정책 |
| --- | --- |
| SQLite | 과거 지원 버전에서 최신 버전으로 Migration |
| 원본 파일 | 동일 Blob 형식 유지 |
| 문서 추출 결과 | Schema Version 기반 판독 및 변환 |
| 프로젝트 가이드 | 과거 Revision 구조 지원 |
| 목차·매핑 | 기존 Revision 유지 |
| Reference | 기존 버전과 원본 유지 |
| Template | 기존 Template Version 사용 가능 |
| SlideSpec | Versioned Schema + 변환기 |
| PPTX | 원본 생성 파일 그대로 보존 |
| Workflow | 정의 버전 및 체크포인트 형식 관리 |
| API | `/api/v1` 호환 정책 유지 |

과거 모든 버전을 무기한 실행 가능한 상태로 유지하는 것이 아니다. 저장된 데이터와 산출물을 최신 버전으로 읽거나 안전하게 변환할 수 있는 경로를 유지한다. 구체적인 지원 릴리스 범위는 별도 확정 대상이다.

## 11.3 Schema Version

다음 구조화 데이터는 반드시 `schema_version`을 가진다.

- Document Extraction Result
- Project Guide
- Outline Representation
- Template Manifest
- PresentationSpec
- SlideSpec
- Workflow Definition
- Workflow Checkpoint

예시:

```json
{
  "schema_version": 2,
  "slide_id": "slide-001",
  "layout_key": "comparison",
  "content": {
    "title": "핵심 기술 비교"
  }
}
```

과거 버전에서 최신 구조로 변환하는 Upcaster를 구현한다. 원본 데이터를 임의로 덮어쓰지 않고 필요한 경우 새로운 버전의 파생 Artifact를 생성한다.

## 11.4 Workflow 호환성

Workflow Run에 실행 당시의 `workflow_definition_version`을 저장한다. 논리 모델의 `definition_id`가 가리키는 정의 버전과 함께 실행 기준을 고정한다.

업데이트 과정에 진행 중인 Workflow가 있으면 해당 버전의 Node Handler로 이어서 실행할 수 있어야 한다.

지원하지 않는 Node 버전이 발견되면 자동으로 다른 그래프로 실행하지 않는다. 관리자에게 호환성 오류를 표시하고, 필요한 경우 명시적인 Workflow State Migration을 통해 새 버전으로 전환한다.

## 11.5 롤백 정책

새 실행 파일이 과거 DB를 읽는 것과 구버전 실행 파일이 새로운 DB를 읽는 것은 별개의 문제다. 기본 정책은 전방 업데이트 호환성이다.

업데이트 실패 후 구버전으로 복귀하려면 **업데이트 전 DB 백업과 해당 파일 스토리지 스냅샷을 함께 복원**한다.

## 13.1 데이터 백업 대상

- SQLite DB
- Blob Store
- 프로젝트 작업에 필요한 영구 Artifact
- 공용 Reference Storage
- 공용 Template Storage
- LLM 설정 암호화 키
- 저장소 Manifest 및 버전 정보

Reference·Template·Blob 루트를 [환경변수](01-deployment-runtime.md)로 분리한 경우에도 백업 대상에 포함한다.

## 13.2 백업 정책

DB는 SQLite Backup API로 일관성 있는 백업을 생성한다. 파일 스토리지는 DB가 참조하는 Blob 목록을 기준으로 스냅샷을 생성한다.

백업 도중 파일 삭제로 불일치가 발생하지 않도록 백업 대상 Blob을 보호한다. 백업본은 가능하면 운영 데이터와 다른 영구 저장소에 보관한다.

## 13.3 복구 정책

복구 시 다음을 검증한다.

1. DB 파일 무결성
2. Migration 버전
3. Blob Hash 및 파일 존재 여부
4. Reference·Template 연결
5. 프로젝트 파일 참조
6. Presentation Revision과 Slide Version 관계
7. 미완료 Workflow 상태

누락된 캐시와 미리보기는 재생성할 수 있다. 원본 파일과 확정 리비전이 누락된 경우에는 복구 오류로 처리한다.

## 14.1 운영 진단

Admin 시스템 상태 화면에서 다음을 제공한다.

- 서버 버전
- DB Schema Version
- DB 무결성
- 스토리지 경로 및 사용량
- 파일 읽기·쓰기 상태
- LibreOffice 상태
- H2Orestart 상태
- PPT Master 상태
- Kordoc 상태
- OCR 모델 무결성
- 외부 LLM 연결 상태
- 실행 중 Workflow 수
- 실패한 Workflow 수
- 마지막 백업 상태

진단 화면은 [Admin UI](07-ui-design.md), 조회 경로는 [REST API](08-rest-api.md)를 따른다.

## 14.2 로깅

가능한 경우 모든 로그에 다음 식별자를 포함한다.

- `request_id`
- `project_id`
- `workflow_run_id`
- `node_run_id`
- `presentation_id`
- `slide_id`

API Key, 문서 원문 전체, 기밀 프롬프트는 기본 로그에 기록하지 않는다.

LLM 요청은 Provider, 모델, 사용량, 지연시간, 상태, 오류 코드 중심으로 기록한다.

## 14.3 보안 범위

일반 사용자 로그인과 사용자별 프로젝트 권한은 없다. Admin 화면과 API는 서버 시작 시 생성·CLI 출력한 임의 토큰이 필요하다. 다음 정책을 적용한다.

- 회사 내부 신뢰 네트워크에서만 접근
- 인터넷 직접 공개 금지
- 회사 Ingress·Gateway에서 네트워크 접근 제한
- Admin API도 동일한 네트워크 보호 대상
- 모든 업로드 파일을 신뢰할 수 없는 입력으로 처리
- 외부 도구 실행 시 Shell Injection 방지
- 원본 경로 및 Tool 실행 경로 검증
- LLM Tool Calling에 명시적 Allowlist 적용
- API Key 암호화 저장
- 임시 파일 및 자식 프로세스 자원 제한
- 프론트엔드·백엔드 동일 출처 사용

사용자별 권한과 감사 추적은 현재 구현 범위에 포함하지 않는다. 저장되는 변경 이력은 리비전과 실행 단위의 기록이며 실제 개인 신원을 증명하지 않는다.

파일 입력·경로·압축 해제 검증은 [스토리지 무결성](05-data-storage.md), 문서 기반 명령 주입 방어와 Tool 제한은 [LLM Gateway](06-llm-admin.md)를 따른다.

## 16. 개발 단계 및 검증 기준

아래 단계는 원문의 순서를 유지한다. 각 Phase의 완료 여부는 구현 범위와 완료 조건으로 판단한다.

### Phase 1. 실행 기반 및 데이터 계층

구현 범위:

- 단일 바이너리 실행
- `--data-storage-path`
- 경로 검증 및 자동 생성
- SQLite 초기화
- refinery Migration
- Blob Storage
- 프로젝트 및 원본 파일 관리
- React 정적 파일 서빙
- 기본 Admin 화면

완료 조건:

- 신규 데이터 경로에서 단일 명령으로 정상 실행
- 기존 데이터 경로로 다시 실행해도 데이터 유지
- 동일 파일을 여러 번 업로드해도 실제 Blob은 하나
- Migration을 반복 실행해도 스키마·데이터 정합성 유지

### Phase 2. 문서 파이프라인

구현 범위:

- 문서 업로드
- LibreOffice PDF 변환
- HWP/HWPX 지원
- Kordoc OCR 및 모델 내장
- PDF 페이지 미리보기
- 텍스트·표 추출
- 콘텐츠 블록 저장
- Workflow 상태 관리

완료 조건:

- 지원하는 파일 형식이 정상적으로 PDF 변환
- 실패한 파일은 원본 보존
- 스캔 문서 OCR이 외부 다운로드 없이 동작
- 페이지별 분석 결과와 원본 위치를 추적 가능

### Phase 3. 프로젝트 분석

구현 범위:

- 프로젝트 가이드
- 가이드 리비전
- 목차 생성
- 목차 편집
- 콘텐츠 자동 매핑
- 중복 매핑
- 검색 인덱스

완료 조건:

- 목차별 원문 근거 추적 가능
- 가이드 수정 시 기존 결과 변경 없음
- 명시적 재실행 시에만 새로운 결과 생성
- 여러 목차가 동일 콘텐츠 블록을 참조 가능

### Phase 4. 공용 라이브러리

구현 범위:

- Reference Storage
- Template Storage
- 환경변수 경로 지정
- 자료 업로드·검색
- 레퍼런스 자동 인덱싱
- PPT Master 템플릿 추출
- 템플릿 추천
- 프로젝트 연결

완료 조건:

- 프로젝트와 독립된 라이브러리 관리
- 동일 원본의 물리 중복 저장 방지
- 템플릿·레퍼런스 버전 유지
- 프로젝트에서 특정 버전 고정 가능

### Phase 5. LLM 및 Workflow Engine

구현 범위:

- 7개 Provider
- Admin 연결 설정
- Vision
- Tool Calling
- Structured Output
- 작업별 모델 라우팅
- Workflow DAG
- Checkpoint
- Retry / Resume
- SSE

완료 조건:

- Admin 설정 후 서버 재시작 없이 모델 호출 가능
- 설정 변경 전 실행 중인 작업의 설정 유지
- Workflow 중단 후 체크포인트부터 복구
- Provider별 Contract Test 통과

### Phase 6. PPT 생성 및 편집

구현 범위:

- PresentationSpec
- SlideSpec
- 스토리라인 생성
- 템플릿 적용
- PPT Master 생성
- Kordoc 결과 검증
- 슬라이드별 미리보기
- 채팅 기반 편집
- 리비전 및 다운로드

완료 조건:

- 선택한 목차로 편집 가능한 PPTX 생성
- 원본 근거 추적 가능
- 변경된 슬라이드만 우선 재생성
- 이전 버전 유지
- 가이드 변경만으로 기존 PPT 자동 재생성 없음

### Phase 7. 엔터프라이즈 품질 검증

구현 범위:

- 이전 버전 DB 업그레이드 테스트
- Storage 무결성 검사
- 백업·복구 테스트
- 문서 변환 실패 테스트
- 30명 동시접속 부하 테스트
- CPU·메모리 제한 테스트
- 오프라인 실행 테스트
- SBOM 및 라이선스 검증

완료 조건:

- 이전 릴리스 데이터가 최신 버전에서 정상 조회
- 원본 파일 및 확정 리비전 손실 없음
- 비정상 종료 후 작업 복구
- 런타임 패키지 다운로드 없이 모든 기능 실행
- 동일 배포본을 반복 설치해도 일관된 동작 유지

오프라인 실행 검증의 범위는 [Offline Runtime 원칙](README.md)을 따른다. 외부 LLM API 호출에 필요한 연결과 런타임 설치·다운로드 의존성을 구분한다.

## 릴리스 전 구체화할 계약

원문에 수치·형식이 지정되지 않은 다음 사항은 구현 과정에서 확정하고 관련 문서에 반영한다.

| 항목 | 담당 문서 |
| --- | --- |
| 최소 여유 공간, 미마운트 저장소 검증 정책 | [배포 및 실행](01-deployment-runtime.md) |
| 업로드 용량·페이지 수·압축 해제 제한, 보존기간 | [데이터 모델과 파일 저장](05-data-storage.md) |
| 자동 품질 수정·재시도 상한, Lease·Heartbeat 정책 | [Workflow와 동시성](04-workflow-engine.md) |
| 지원 DB·Artifact·Node 버전 범위와 Upcaster 경로 | 이 문서의 호환성 정책 |
| 요청·응답 스키마, 멱등성·충돌·SSE의 세부 계약 | [REST API](08-rest-api.md) |
| 실제 도구·모델·폰트 버전, 번들 무결성과 라이선스 | [아키텍처](02-system-architecture.md), [배포](01-deployment-runtime.md) |

이 목록은 원문 요구사항의 삭제나 대체가 아니라 상세 설계가 필요한 지점의 표시다.

## 사용자 경험 적용 범위

사용성 수용 검증은 일반 사무직의 프로젝트 생성·자료 찾기·장표 검토·수정·실패 복구 여정으로 수행한다. 기술 지식 없이 다음 행동을 찾을 수 있어야 하며 진단 정보 비노출과 정직한 샘플 표시를 함께 확인한다. 공통 기준은 [일반 사무직을 위한 사용자 경험 계약](07-ui-design.md#일반-사무직을-위한-사용자-경험-계약)을 따른다.
