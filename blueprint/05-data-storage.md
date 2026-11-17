# 데이터 모델과 파일 저장

PreM 통합 제품·기술 설계서 v2.0. 원문 **6장, 7장**을 수록한다. [문서 색인](README.md)

## 6.1 설계 규칙

- 모든 테이블에 명확한 Primary Key를 지정한다.
- 관계는 Foreign Key로 표현한다.
- 반복되는 다대다 관계는 별도 연결 테이블을 사용한다.
- 같은 원문 텍스트를 여러 테이블에 복사하지 않는다.
- 원본 바이너리는 SQLite BLOB 컬럼에 저장하지 않는다.
- 파일은 Content Hash로 식별한다.
- 변경 이력이 필요한 데이터는 불변 리비전을 사용한다.
- JSON 컬럼은 스키마가 유연한 구조화 산출물에 제한적으로 사용한다.
- 외래 키 제약과 Unique Constraint를 DB에서 강제한다.
- 검색 인덱스와 미리보기는 재구축 가능한 파생 데이터로 관리한다.

아래 표는 원문의 주요 필드 중심 논리 모델이다. 모든 PK·FK·NULL 조건·인덱스와 동시 수정 제약을 정의한 완성 DDL은 아니므로, 실제 Migration에서 위 규칙을 구체화해야 한다.

## 6.2 핵심 테이블

### 프로젝트

| 테이블 | 주요 필드 |
| --- | --- |
| `projects` | `id, name, status, due_date, created_at` |
| `project_files` | `id, project_id, file_registration_id, role` |
| `project_guides` | `project_id, current_revision_id` |
| `project_guide_revisions` | `id, project_id, parent_revision_id, schema_version, content_json, created_at` |

가이드 내용은 해당 리비전에 한 번 저장한다. `projects`에 가이드 본문을 중복 저장하지 않는다.

### 파일 및 Artifact

| 테이블 | 주요 필드 |
| --- | --- |
| `file_blobs` | `sha256, size_bytes, detected_mime, created_at` |
| `file_registrations` | `id, blob_sha256, original_filename, created_at` |
| `artifacts` | `id, blob_sha256, kind, schema_version, producer_node_run_id, created_at` |

같은 파일 내용을 여러 프로젝트에서 사용해도 `file_blobs`에는 한 건만 존재한다. 업로드 횟수와 원래 파일명이 다르면 `file_registrations`에 각각 기록한다.

실제 파일 경로는 SHA-256으로 결정할 수 있으므로 불필요한 절대 경로를 DB에 중복 저장하지 않는다. 업로드 등록, 생성물 메타데이터, 물리 바이트를 분리하여 동일 Blob을 재사용한다.

### 문서 추출

| 테이블 | 주요 필드 |
| --- | --- |
| `document_extractions` | `id, source_blob_sha256, extraction_profile_hash, normalized_artifact_id, status` |
| `document_pages` | `id, extraction_id, page_number, width, height, preview_artifact_id` |
| `content_blocks` | `id, page_id, block_order, block_type, text, bbox_json, attributes_json` |

`document_extractions`에는 다음 제약을 적용한다.

```sql
UNIQUE (
    source_blob_sha256,
    extraction_profile_hash
)
```

분석 프로필에는 변환 도구 버전, OCR 모델 버전, 폰트 구성, 추출 옵션이 포함된다. 같은 원본이라도 분석 도구 버전이 바뀌면 새로운 추출 결과를 생성할 수 있다. 기존 결과는 명시적 재실행 정책에 따라 유지한다.

### 목차 및 콘텐츠 매핑

| 테이블 | 주요 필드 |
| --- | --- |
| `outlines` | `id, project_id, kind, current_revision_id` |
| `outline_revisions` | `id, outline_id, parent_revision_id, created_at` |
| `outline_nodes` | `id, outline_id` |
| `outline_node_versions` | `id, node_id, title, attributes_json` |
| `outline_revision_nodes` | `revision_id, node_id, node_version_id, parent_node_id, sort_order` |
| `content_assignment_sets` | `id, outline_revision_id, workflow_run_id` |
| `content_assignments` | `assignment_set_id, outline_node_id, content_block_id, role, score` |

변경되지 않은 목차 노드는 기존 `outline_node_versions`를 재사용한다. 목차 리비전은 노드 버전과 배치 관계만 연결한다.

같은 콘텐츠가 여러 목차에 사용되어도 원문 텍스트를 복사하지 않고 별도의 연결 행을 생성한다.

### Reference Library

| 테이블 | 주요 필드 |
| --- | --- |
| `reference_items` | `id, title, scope, project_id, status` |
| `reference_versions` | `id, reference_id, file_registration_id, extraction_id, created_at` |
| `reference_tags` | `id, name` |
| `reference_tag_links` | `reference_id, tag_id` |

Reference의 본문은 `content_blocks`에서 조회한다. 검색 인덱스는 해당 본문으로부터 생성한다.

`scope`와 `project_id`를 통해 공용과 프로젝트 로컬 자산을 구분한다. 라이브러리 사용 범위는 [사용자 기능](03-product-features.md)을 따른다.

### Template Library

| 테이블 | 주요 필드 |
| --- | --- |
| `template_items` | `id, title, scope, project_id, status` |
| `template_versions` | `id, template_id, file_registration_id, extraction_artifact_id, created_at` |
| `template_layouts` | `id, template_version_id, layout_key, layout_type, attributes_json` |
| `template_tags` | `id, name` |
| `template_tag_links` | `template_id, tag_id` |

템플릿 추출 결과와 원본 PPTX는 별도 Artifact로 관리한다. 원본 업로드 등록은 `file_registration_id`, 추출 산출물은 `extraction_artifact_id`로 연결하며 실제 바이트는 Blob으로 관리한다.

템플릿이 업데이트되어도 과거 PPT에 사용된 Template Version은 변경하지 않는다.

### 프레젠테이션 및 슬라이드

| 테이블 | 주요 필드 |
| --- | --- |
| `presentations` | `id, project_id, title, current_revision_id` |
| `presentation_revisions` | `id, presentation_id, parent_revision_id, guide_revision_id, outline_revision_id, output_artifact_id` |
| `slides` | `id, presentation_id` |
| `slide_versions` | `id, slide_id, spec_artifact_id, preview_artifact_id, created_at` |
| `presentation_revision_slides` | `presentation_revision_id, slide_id, slide_version_id, position` |
| `slide_evidence` | `slide_version_id, content_block_id, reference_version_id, evidence_role` |

슬라이드를 수정하면 새로운 `slide_versions` 행을 생성한다. 변경하지 않은 슬라이드는 기존 `slide_version_id`를 그대로 재사용한다.

새 프레젠테이션 버전은 해당 시점에 사용하는 슬라이드 버전의 목록만 보관한다. 변경하지 않은 슬라이드의 Spec과 렌더 결과를 반복 저장하지 않는다.

### Workflow

| 테이블 | 주요 필드 |
| --- | --- |
| `workflow_definitions` | `id, name, version, definition_hash` |
| `workflow_runs` | `id, definition_id, project_id, status, guide_revision_id, started_at` |
| `node_runs` | `id, workflow_run_id, node_key, attempt, status, input_artifact_id, output_artifact_id, lease_until` |
| `workflow_events` | `id, workflow_run_id, node_run_id, event_type, payload_json, created_at` |

각 Workflow Run은 실행 당시의 정의 버전과 입력 리비전을 참조한다. 중단 후 복구 시에도 같은 버전으로 이어간다.

체크포인트, Lease, Heartbeat, 노드 상태와 재시도 계약은 [Workflow](04-workflow-engine.md), 실행 정의·Node Handler 업데이트는 [호환성](09-operations-delivery.md)을 따른다.

### LLM

설정·모델·라우팅 테이블은 `model_registry`가, `llm_requests`는 실제 추론 요청을 수행하는 `inference`가 쓰기를 소유한다. 요청은 설정 버전을 참조하고 설정 본문을 복제하지 않는다. 경계는 [본개발 소스 아키텍처](02-system-architecture.md)를 따른다.

| 테이블 | 주요 필드 |
| --- | --- |
| `llm_provider_connections` | `id, provider_type, name, enabled, current_config_version_id` |
| `llm_provider_config_versions` | `id, connection_id, base_url, api_format, encrypted_secret, config_json` |
| `llm_models` | `id, connection_id, model_identifier, capabilities_json` |
| `llm_routing_rules` | `id, task_type, model_id, priority, enabled` |
| `llm_requests` | `id, workflow_run_id, node_run_id, provider_config_version_id, model_id, status, token_usage_json, elapsed_ms` |

API Key는 암호화하여 저장하고 로그나 API 응답에 복호화된 값을 노출하지 않는다.

새 설치에서는 데이터 경로에 암호화 키를 생성한다. 운영 보안을 강화할 경우 외부 Secret 파일을 주입할 수 있도록 한다. 키 파일과 암호화 DB를 같은 저장소에 두는 방식만으로 스토리지 전체 유출을 방어할 수 없으므로, 운영에서는 회사 Secret 관리 체계를 우선한다.

실행 중 요청·Workflow의 설정 버전 유지와 동적 변경 절차는 [LLM Gateway와 Admin](06-llm-admin.md)에 정의한다.

## 6.3 DB 중복 방지 정책

| 데이터 | 기준 저장 위치 | 다른 기능에서 사용 |
| --- | --- | --- |
| 원본 파일 바이트 | `file_blobs` + Blob Store | Blob Hash 참조 |
| 파일명·업로드 기록 | `file_registrations` | Registration ID 참조 |
| 원문 텍스트 | `content_blocks` | Block ID 참조 |
| 프로젝트 가이드 | `project_guide_revisions` | Revision ID 참조 |
| 목차 | Outline Revision/Node Version | Node Version 참조 |
| 레퍼런스 | Reference Version | Version ID 참조 |
| 템플릿 | Template Version | Version ID 참조 |
| 슬라이드 내용 | SlideSpec Artifact | Artifact ID 참조 |
| PPTX 결과물 | Artifact Store | Artifact ID 참조 |
| 모델 설정 | Provider Config Version | Config Version ID 참조 |

검색 인덱스, 이미지 미리보기, 렌더링 캐시, 출력 파일처럼 실제 성능을 위해 필요한 파생 데이터는 저장할 수 있다. 원본과 구분하고 재생성 가능한 결과로 관리한다.

재구축 가능한 캐시와 보존해야 하는 확정 생성물을 구분한다. 확정 PPTX·슬라이드 리비전은 [업데이트·복구 정책](09-operations-delivery.md)에 따라 보존하며, 사용자의 명시적 요청 없이 새 결과로 대체하지 않는다.

## 7.1 Content-Addressable Storage

모든 영구 파일은 SHA-256으로 식별한다.

```text
blobs/
└── sha256/
    └── ab/
        └── cd/
            └── abcdef...전체SHA256
```

### 저장 절차

1. 업로드 데이터를 임시 파일로 스트리밍한다.
2. 저장하면서 SHA-256과 크기를 계산한다.
3. 실제 파일 형식과 위험 요소를 검사한다.
4. 같은 Hash 파일이 존재하는지 확인한다.
5. 없으면 Blob Store에 원자적으로 저장한다.
6. SQLite에 Blob 및 파일 등록 정보를 기록한다.
7. 프로젝트 또는 라이브러리에 연결한다.

Blob 저장과 DB 등록 사이에 프로세스가 중단될 수 있으므로 미등록 Blob은 나중에 정리할 수 있도록 한다.

임시 파일의 파일시스템과 경로 검증은 [배포 및 실행](01-deployment-runtime.md) 기준을 따른다.

## 7.2 원본 관리 정책

- 원본 파일 덮어쓰기 금지
- 원본 교체는 새 파일 등록으로 처리
- 원본 다운로드 지원
- 원본별 업로드·사용 이력 보존
- PDF 변환본과 원본 구분
- 원본·변환본 간 생성 관계 기록
- 참조 중인 원본은 물리 삭제 금지
- 삭제는 우선 논리 삭제 처리
- 미참조 Blob만 보존기간 이후 정리
- Blob 정리 전 DB 참조 및 백업 정책 확인

보존기간의 구체적인 값은 별도 확정 대상이다. 백업 중 보호해야 하는 Blob과 복구 검증은 [백업·복구](09-operations-delivery.md)를 따른다.

## 7.3 스토리지 무결성

- SHA-256 무결성 확인
- 파일 크기 검증
- 원자적 파일 생성
- 임시 파일 자동 정리
- 경로 탐색 공격 방지
- 심볼릭 링크 및 경로 탈출 검증
- 프로젝트 ID 기반 작업 디렉터리 격리
- 파일 압축 해제 크기 제한
- 업로드 용량·페이지 수 제한
- ZIP Bomb 및 비정상 문서 검사

실제 업로드 용량·페이지 수·압축 해제 한도는 Pod 자원과 운영 정책을 기준으로 별도 확정한다.

## 파일/콘텐츠 이중 검색과 삽입 자산

논리 자산의 불변 버전 아래 추출 component를 관리한다. component에는 종류(text/image/chart/slide/layout), source page/slide, bbox, preview_artifact_id, native_artifact_id, editable capability와 실패 원인을 둔다. 파일 인덱스는 파일명·제목·태그, 콘텐츠 인덱스는 canonical block/component 텍스트를 참조한다. 검색용 요약과 이미지 설명은 버전 있는 파생 Artifact이며 원문을 대체하지 않는다.

PPT 슬라이드/차트 component에는 master·layout·theme·font·media·workbook 의존성 Artifact 연결을 둔다. SlideSpec의 source insertion은 고정된 자산 버전과 component ID를 참조하고 별도 원문 복사를 하지 않는다. 검색 집계는 파일별 hit 그룹과 개별 content hit를 모두 반환한다. 사용자 업로드는 추출 완료 전 검색 가능한 실제 콘텐츠가 있는 것처럼 표시하지 않는다.

## 프로젝트 마감일 계약

프로젝트의 일정 값은 **마감일(Due Date)** 하나이며 canonical 필드는 `projects.due_date`다. 시간대 없는 `YYYY-MM-DD`로 저장하고 신규 등록에 필수 입력한다. 기존 날짜 미정 데이터는 null을 유지한다. 프로젝트 시작일/종료일 쌍은 만들지 않는다. 생성 요청 멱등성 기록은 당시 날짜 `original_due_date`를 보관한다. V3 Migration은 V2 컬럼을 이름 변경해 기존 값·리비전·삭제 상태를 보존한다. 세부 구현 계약은 [현재 데이터/API](../dev-docs/04-data-api.md)를 따른다.

## Space 원본 등록 구현

V4는 공통 Blob/파일 등록, 분리된 Reference·Template 항목/불변 파일 버전/태그, 멱등 업로드 receipt를 구현한다. 항목의 CAS version과 파일 version number는 서로 다른 값이다. SHA-256 경로에 원본을 게시한 다음 관련 DB 행을 하나의 트랜잭션에 확정하며 취소와 완료는 receipt로 직렬화한다. 종료 시 임시 작업을 정리하고 재시작 시 미완료 receiving을 failed로 전환한다.

자료 본문 추출·Artifact lineage·보존기간 GC·전체 파일 백업은 후속 구현이다. 논리 삭제한 원본과 버전은 물리 보존한다. 구현 필드·한도·오류·복구 범위는 [현재 데이터/API](../dev-docs/04-data-api.md)의 Space 계약을 따른다.

## 구현된 Provider 저장 구조

V5에서 추가한 스키마는 `llm_provider_connections`의 현재 설정 포인터와 `llm_provider_config_versions`의 불변 name/provider_type/base_url/model_identifier/timeout/enabled/암호문을 분리한다. 복합 FK로 다른 연결의 설정 버전을 참조하지 못하게 한다. 현재 모델 ID는 설정 버전에 고정하며 별도 모델 catalog·routing table은 첫 라우팅 기능과 함께 구현한다.

`llm_requests`는 설정 버전 ID, 진단 종류, 상태, 시간, 사용량과 공개 오류 코드만 기록한다. 프롬프트·응답 본문·API Key는 저장하지 않는다. 키는 XChaCha20Poly1305 v1 envelope로 저장하고 config revision ID를 AAD에 포함한다. 실제 테이블·필드와 수용 조건은 [데이터·API 문서](../dev-docs/04-data-api.md#provider-설정진단-api)가 담당한다.

V6는 native Provider 종류를 확장하면서 V5 설정 UUID·암호문·요청 참조를 보존한다. 이전 lm_studio 리비전의 의미는 OpenAI 호환으로 유지하고 Native 전환은 새 리비전으로 저장한다.


V7는 기존 생성 연결에 native decision protocol kind를 추가하며 category는 저장된 kind에서 유도한다. `llm_requests`는 역사적 이름을 유지하고 `kind=decision`을 허용한다. 공통 model_execution의 RequestStore와 SQLite model_requests adapter가 이 테이블의 쓰기를 소유한다. 판정 결과 본문/Artifact의 영속화는 아직 구현하지 않았으며 Admin 테스트는 설정 참조·상태·시간·토큰 수만 보존한다.

## 사용자 경험 적용 범위

정규화·불변 리비전·Blob 저장 원칙은 유지한다. 파일·출처·페이지·필요한 저장 기록만 사용자에게 제시하며 내부 ID와 저장 경로를 자료 미리보기에 표시하지 않는다. 공통 기준은 [일반 사무직을 위한 사용자 경험 계약](07-ui-design.md#일반-사무직을-위한-사용자-경험-계약)을 따른다.

## 연결별 요청 처리 설정

V10의 model_request_capacity는 connection_id 외래 키·version·max_parallel·queue_capacity·queue_timeout_seconds를 소유한다. 모델 인증/endpoint의 불변 config와 독립적이며 실행 중·대기 중 수는 파생 메모리 상태로 유지한다. 기존 모델 리비전과 요청 이력을 수정하지 않는다.

## 재사용 자료 저장 계약

`document_native_packages(extraction_id, bundle_blob_sha256, schema_version)`와 `document_materials(id, extraction_id, page_id, source_key, kind, source_order, title, content_block_id, native_locator_json, preview_blob_sha256, preview_scope)`를 사용한다. page/extraction과 block/page 복합 외래 키로 다른 원본의 구성 요소 연결을 방지한다. 텍스트는 content_blocks에만 저장하며 API의 읽기 모델에서 결합한다. native locator는 원본 패키지의 slide part와 shape ID, 원본 이미지 관계를 보존한다. 원본 파일과 미리보기/파생 패키지는 공통 Blob Store를 사용한다. 추출 schema 1은 변경하지 않고 schema 2 자료를 별도 생성한다.


## 공통 PPT 추출과 패키지 저장 계약

동일 원본과 동일 분석 프로필의 공통 PPT 결과는 `ppt_imports`에 한 번 등록한다. 템플릿은 `template_import_links`, 레퍼런스는 `document_native_packages`로 연결하고 각 기능의 버전·업무 이력은 분리한다. 패키지는 순서가 고정된 파일 경로/해시/크기 목록으로 저장하며 `asset_package_members`가 개별 Blob을 참조한다. 구조 JSON과 이미지는 다른 패키지에서도 내용 해시로 공유한다. 템플릿 구조 본문을 DB와 ZIP에 각각 저장하지 않는다.

ZIP은 필요한 시점에 고정된 순서·시간·권한으로 조립하는 파생 전달 형식이다. 임시 산출물의 생성·취소·응답 종료·정상/비정상 종료 정리를 소유하고 준비/다운로드 수를 제한한다. 원본 PPTX와 확정된 과거 ZIP 결과는 그대로 보존한다. 기존 결과의 자동 재추출 없이 새 Migration과 새 추출 프로필로 적용한다.

Blob 게시·수거 후 디렉터리 항목은 capability 범위 안에서 읽기 가능한 핸들로 다시 열어 동기화한다. Linux의 경로 전용 디렉터리 핸들에 직접 fsync하지 않는다. 미참조 수거는 시작 시 독점 잠금 아래에서 수행한다. DB 전체 FK, 패키지 구성, 과거 버전 및 로컬 백업 참조를 검사하고 최초 미참조 관찰 후 최소 7일을 보장한다. 삭제 직전 재검사하며 애매한 백업·경로는 삭제하지 않는다. 현재 구현은 시작당 1,000개 제한이며 실행 중 GC와 확정 버전 폐기는 후속 범위다.


## 프로젝트 원본 확인과 가이드 리비전

`source_items(project_id)`와 `source_versions(file_registration_id)`는 프로젝트별 원본 등록과 불변 파일 버전을 소유한다. 공용 reference/template 테이블에 원본을 대신 넣지 않는다. document_jobs는 reference/template/source 버전 중 정확히 한 입력을 참조한다. 업로드 receipt는 프로젝트 범위를 고정한다. 원본/프로필 기반의 document_extractions와 Blob Store는 공유한다.

`project_source_reviews`와 `project_source_review_files`는 사용자가 확인한 source version/extraction ID 집합을 보존한다. 현재 집합이 달라지면 과거 review를 덮어쓰지 않고 완료 여부만 다시 계산한다. `project_guide_revisions`는 project, parent revision, version, Do/Don’t와 생성 시각을 저장하고 조건부 저장한다. 현재 DB 구조에서 작성 방향은 이 테이블 하나가 정본이다.


## 관계 검색 정본

검색 원본 snapshot, 후보, 프로젝트별 출처, 관계 판정, 선택 상태/이력은 relation_runs/sources/candidates/origins/assessments/links/link_changes로 정규화한다. 원문은 content_blocks, 파일은 기존 Blob과 file_registration을 계속 참조한다. file/block 후보의 중복은 DB partial unique index로도 방지한다. 같은 입력과 판정 정의/모델 설정의 완료 결과를 재사용하며 출처 정보와 원문을 캐시 본문으로 복제하지 않는다. 실패값은 비관련 판정으로 대체하지 않는다. 정확한 API/제한은 [현재 데이터 계약](../dev-docs/04-data-api.md#관계-검색-저장api-계약)을 따른다.


### 등록 단위의 텍스트 해석

파일 바이트의 중복 제거와 문서 해석 형식은 구분한다. 동일 UTF-8 바이트를 HTML/Markdown으로 각각 등록해도 Blob은 하나를 사용하지만 불변 등록 정보에 따라 형식·MIME·추출 profile을 결정한다. 현재 구현은 V16 `registered_file_facts` view로 이 규칙을 공유한다. 캐시는 원본 Hash와 형식별 분석 profile을 함께 사용하며 기존 원본이나 추출을 덮어쓰지 않는다.


### 구현된 목차 리비전과 연결

V17의 outline_heads/revisions/nodes/node_versions/revision_nodes는 현재 포인터와 불변 노드/배치를 분리한다. outline_assignments는 정본 content_block_id와 source_version_id만 연결하고 본문을 복사하지 않는다. outline_confirmations는 특정 리비전의 확인 기록이다. outline_runs/run_blocks/run_batches/run_commands는 입력 고정, 체크포인트, 모델 요청 계보와 멱등 명령을 보존한다. 이전 테이블·원본·확정 리비전은 재작성하지 않는다.

### 검색 작업 공간 데이터

V18의 relation_workspaces, relation_reads, relation_workspace_peers, relation_review_history, relation_pulls는 실행 정의·단계·원문 범위·판정 이력·추가 검색을 보존한다. 본문은 content_blocks에서 읽고 복제하지 않는다. 현재 판정 연결이 바뀌어도 이전 불변 판정과 읽기 범위는 남긴다. 생성/판정 모델 설정 버전을 각각 고정하고 파일·페이지·버전 근거를 제공한다.

### V19 구현의 발표자료 저장 경계

현재 근거 확정·디자인·생성 작업·슬라이드 Spec/근거·출력 리비전은 presentation 계열 테이블로 구현되어 있다. 원문과 모델 설정은 기존 canonical ID를 참조하고 파일 바이트는 공통 Blob으로 유지한다. 상세 실제 컬럼·CAS·lease·멱등 계약은 [V19 데이터/API](../dev-docs/04-data-api.md#v19-발표자료-준비생성)가 소유한다. 앱 내 객체 편집과 변경 슬라이드 버전 재사용은 아직 구현하지 않았다.

## 장표별 렌더링 파생 데이터

현재 구현은 프로젝트별 content key를 갖는 presentation_render_cache와 실행·장표에 연결되는 presentation_quality_checks로 검사 결과를 저장한다. 원문·Spec·차트 데이터는 복사하지 않고 네이티브 PPTX·미리보기 Blob FK와 고정 코드 결과를 참조한다. 장표 위치·템플릿·실제 사용한 원본 버전·런타임이 같을 때만 재사용한다. LRU 캐시는 프로젝트당 512개·512 MiB로 제한하고, 확정 리비전·지속 검사 기록·기존 백업/미참조 Blob 보호 정책과 구분한다. 자세한 현재 필드는 [구현 데이터 계약](../dev-docs/04-data-api.md#v29-per-slide-quality-and-render-cache)을 따른다.
