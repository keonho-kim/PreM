# Workflow와 동시성

PreM 통합 제품·기술 설계서 v2.0. 원문 **5장, 12장**을 수록한다. [문서 색인](README.md)

## 5.1 기본 구조

LangGraph형 단계 실행 모델을 Rust에서 자체 구현한다.

```text
Workflow Definition
       ↓
Workflow Run
       ↓
Node Scheduler
       ↓
Node Executor
       ↓
Checkpoint
       ↓
Conditional Routing / Join
       ↓
Next Node
```

### 노드 유형

| 노드 | 처리 내용 |
| --- | --- |
| Rule | 규칙 기반 판단 |
| LLM | 모델 호출 |
| Decision | 조건부 분기·점수 평가 |
| Search | 검색 및 후보 수집 |
| Tool | 외부 도구 실행 |
| Parallel | 병렬 작업 실행 |
| Join | 결과 병합 |
| Validation | 구조·내용·품질 검증 |
| Human Gate | 사용자 확인 대기 |

### 노드 상태

```text
PENDING
READY
RUNNING
WAITING_USER
SUCCEEDED
FAILED
CANCELLED
SKIPPED
```

모든 노드는 입력·출력 스키마와 실행 버전을 가진다. 실행 결과는 SQLite에 기록하고 큰 결과물은 Artifact Storage에 저장한다.

재시도는 해당 노드부터 실행하며 완료된 선행 단계는 재사용한다. 각 Run은 시작 당시 정의 버전, 입력 리비전 및 설정 버전을 기준으로 실행·복구한다. 저장 테이블은 [데이터 모델](05-data-storage.md), 업데이트 중 호환성은 [호환성 정책](09-operations-delivery.md)을 따른다.

## 5.2 Document Workflow

```text
Upload
  ↓
Validate
  ↓
Normalize PDF
  ├── Render Preview
  └── Extract Content
          ↓
     OCR if required
          ↓
     Structure Blocks
          ↓
     Build Search Index
          ↓
     Detect Outline
          ↓
     Generate Outline
          ↓
     Content Mapping
          ↓
       Completed
```

### 실행 조건

- 신규 문서 업로드 시 최초 분석 실행
- OCR은 필요한 페이지에만 실행
- 목차 자동 생성에는 프로젝트 가이드 적용
- 동일 원본과 동일 분석 프로필의 결과가 있으면 캐시 활용
- 가이드 수정만으로 기존 분석을 재실행하지 않음

LLM 미설정 상태에서도 업로드는 가능해야 한다. LLM이 필요한 단계는 [설정 대기 상태](06-llm-admin.md)를 표시한다.

### 문서 분류: 이진 판정과 명시적 분기

문서의 의미 분류는 System One 형태의 `state + questions`를 받는 교체 가능한 판정 경계를 사용한다. 일반 LLM bridge와 네이티브 판정 API adapter는 같은 Decision 계약을 구현한다. 애플리케이션의 최종 목차 판정은 정수 `1`(해당) 또는 `0`(해당하지 않음)이며 최초 판정 이름은 `is_table_of_contents`다. 원문 목차 영역 식별은 새 발표 목차 생성 및 본문 제목 계층 추출과 구분한다. Admin 샘플 판정은 구현되어 있으나 문서 블록 연결·Artifact 저장·Workflow 분기는 구현 예정이며 현재 Space 업로드는 판정을 실행하지 않는다.

판정 단위는 페이지 전체가 아닌 추출된 영역/블록 묶음이다. 같은 페이지에 목차와 본문이 함께 있을 수 있으므로 입력에 고정된 추출 리비전, 대상 블록 ID, 페이지 위치와 제한된 주변 문맥을 포함한다. HTML처럼 원본 페이지가 없는 문서는 블록 위치를 사용한다. 길이가 긴 입력을 조용히 잘라 확정 판정하지 않고 처리 가능한 단위로 나누거나 미완료 상태로 남긴다.

아래는 어댑터 검증 이후의 내부 결과 예시이며 System One wire 응답이 아니다. 실행기가 질문 ID에 연결된 대상 블록을 보관하고, 선택값 `"1"` 또는 `"0"`을 명시적으로 정수로 변환한다. `source_block_ids`는 판정 대상의 출처이며 모델이 선택한 설명·근거라는 의미는 아니다. 모델·설정·추출 버전도 실행기가 고정한다.

```json
{
  "is_table_of_contents": 1,
  "source_block_ids": ["block-12", "block-13"]
}
```

- 초기 요청은 `choice`의 두 선택지 `"0"`, `"1"`을 사용한다. 질문별 허용 선택지와 응답 ID를 검증하며 누락·중복·예상하지 않은 ID는 거부한다. LLM 생성 응답의 추가 필드·임의의 자연어는 거부하고, native 프로토콜의 부가 통계는 업무 답변과 분리한다. 내부 이진 값으로 변환한 뒤 원본 블록 연결을 검증한다. 프로토콜과 내부 schema의 변환은 [Decision Adapter 계약](06-llm-admin.md#system-one-형태의-decision-adapter)을 따른다.
- `1`은 원본 목차 항목 추출 단계로, `0`은 일반 콘텐츠 처리 단계로 연결한다. `0`인 본문에서도 별도의 제목 계층 추출이 가능하며, 어느 분기도 원문을 삭제하거나 검색 대상에서 자동 제외하지 않는다.
- 호출 실패·시간 초과·잘못된 JSON·근거 검증 실패는 `0`이 아니다. 작업 상태와 판정값을 분리하고, 유효한 판정이 없으면 분기를 실행하지 않는다. 재시도 상한 이후 실패 또는 사용자 확인 상태로 남긴다.
- 모델이 선언하는 confidence를 검증된 확률로 취급하지 않는다. 확정된 이진 결과도 모델의 판정이며 사실 보장이 아니므로 원본 근거를 확인할 수 있어야 한다.
- 파일 형식·크기·추출 성공 여부 같은 결정적 검사는 파서와 규칙이 맡는다. LLM은 의미 판정만 수행하고 다음 노드·도구 실행 권한을 선택하지 않는다. 문서 안의 명령은 판정 데이터로만 취급한다.
- documents는 판정 입력·의미·근거 검증을, decisions는 판정 계약·배치 검증을, model_execution은 공통 호출·요청 이력을, Workflow의 Decision 노드는 검증된 값의 분기를 소유한다. 연결 진단용 프롬프트를 재사용하지 않는다.
- 결과는 원본 블록을 복사하지 않는 버전된 파생 Artifact로 저장한다. 추출 리비전, 대상 블록, 판정 정의/프롬프트/schema 버전, Provider 설정 버전, 모델 ID 및 요청 ID를 연결한다. 동일한 고정 입력의 완료 결과를 재사용하며 설정 변경만으로 재분류하지 않는다.
- 초기 구현은 구조화 출력이 지원되는 연결을 명시적으로 선택한다. 현재 LM Studio Native 연결은 JSON Schema 제약을 지원하는 것으로 취급하지 않는다. 같은 로컬 모델을 공식 호환 연결로 별도 등록·검증할 수 있으며, 프로토콜을 조용히 전환하거나 일반 텍스트 요청을 제약된 출력으로 표시하지 않는다.

같은 입력 문맥에서 독립적인 영역별 질문은 모델 한도 내에서 한 요청으로 묶는다. 질문 ID는 결과 연결용이므로 판정할 `state` 경로를 각 질문의 instructions에 명시한다. 검증된 결과는 재사용하고 실패·누락 영역만 별도 재시도하되, 잘리거나 해석할 수 없는 응답에서 임의로 결과를 복구하지 않는다. 일반 LLM의 배치 요청이 Jev와 같은 병렬 추론·지연시간을 갖는다고 가정하지 않는다.

판정 호출은 목차 제목·항목 같은 자유 텍스트를 생성하지 않는다. 긍정 영역들의 목차 추출은 별도 파서 또는 생성 요청으로 묶는다. 이렇게 판정과 추출의 계약을 분리해야 생성 기능이 없는 Jev로 교체할 수 있다. 단순 호출 수보다 출력 한도·재시도 비용·추출 정확도를 함께 검증한다.

검증에는 목차 영역, 일반 본문, 제목에만 ‘목차’가 들어간 문단, 목차와 본문이 섞인 페이지, 다중 페이지 목차를 포함한다. schema 위반·외부 블록 참조·모델 미설정·중단 후 복구·설정 변경 후 기존 결과 유지도 확인한다. 판정 정확도는 사람이 표시한 자료에서 오탐·누락을 구분해 평가하며, schema 검증 통과를 의미 정확도로 간주하지 않는다.

## 5.3 Reference Discovery Workflow

```text
Selected Outline
       ↓
Project Guide
       ↓
Requirement Extraction
       ↓
Search Query Generation
       ↓
Reference Retrieval
       ↓
Candidate Ranking
       ↓
Evidence Verification
       ↓
Reference Assignment
       ↓
User Review
```

검색은 FTS5와 선택적 벡터 검색을 조합한다. LLM은 검색 질의 구성, 결과 평가, 근거 판단에 사용한다.

근거가 발견되지 않으면 없는 것으로 기록하고 임의로 생성하지 않는다. 검색 대상의 공용·프로젝트 로컬 범위는 [Reference Library](03-product-features.md) 정책을 따른다.

## 5.4 Template Discovery Workflow

```text
Template Uploaded?
  ├── Yes → PPTX Import
  │             ↓
  │       Template Extraction
  │             ↓
  │       Layout Validation
  │
  └── No  → Library Search
                ↓
          Template Ranking
                ↓
          Preview Candidates
                ↓
          Template Selection
                ↓
             Completed
```

템플릿 추출과 추천은 독립 노드로 관리한다. 위 도식은 원문의 업로드 유무별 처리 흐름이다. 업로드 경로에서도 검증 후 최종 선택을 사용자에게 제공해야 하며, 업로드 여부와 관계없이 사용자의 선택권을 보장한다.

사용자가 지정한 템플릿은 자동 추천보다 우선한다.

## 5.5 Presentation Generation Workflow

```text
Generation Request
       ↓
Build Generation Context
       ↓
Retrieve Content / Evidence
       ↓
Build Storyline
       ↓
Create Slide Plans
       ↓
Resolve Templates / Layouts
       ↓
Generate Slide Specs
       ↓
Render Individual Slides
       ↓
Assemble PPTX
       ↓
Kordoc Extraction
       ↓
Validation
       ├── Pass → Publish
       └── Fail → Repair Candidate
                       ↓
                   Revalidate
```

자동 수정은 최초 생성 Workflow의 품질 검증 과정에 한정한다. 최초 생성 완료 후에는 사용자 요청 없이 결과물을 다시 생성하지 않는다.

자동 수정 반복 횟수에는 상한을 두고, 해결하지 못한 오류는 사용자에게 표시한다. 현재 구현의 최초 미확정 생성은 최대 두 단계의 글자 크기 보정으로 제한한다. 원문·차트 값·근거를 삭제하거나 바꾸지 않고, 해결되지 않은 장표는 게시를 중단한다. 대화 편집은 이미 확인한 동일 제목·본문의 조판 크기를 유지하며 새 내용에 추가 자동 보정을 적용하지 않는다.

## 5.6 Slide Revision Workflow

```text
User Edit Request
       ↓
Resolve Scope
       ↓
Load Current Slide Revision
       ↓
LLM Tool Calling
       ↓
Generate Patch
       ↓
Apply Patch to New Spec
       ↓
Render Changed Slides
       ↓
Validate
       ↓
Preview Difference
       ↓
Commit New Revision
```

기존 PPTX 전체 생성보다 변경된 슬라이드 렌더링을 우선한다. 사용자가 최종 다운로드를 요청할 때 필요한 경우 프레젠테이션 전체를 새 리비전으로 조립한다.

기존 SlideSpec을 덮어쓰지 않으며, 생성이 완료된 버전만 사용자에게 적용한다. 변경 적용·취소 및 이전 리비전 복원을 제공한다.

## 5.7 재실행 정책

| 이벤트 | 실행 정책 |
| --- | --- |
| 최초 원본 업로드 | 최초 Document Workflow 실행 |
| 프로젝트 가이드 저장 | 실행 없음 |
| 목차 수동 수정 | 목차 리비전 저장, 실행 없음 |
| 레퍼런스 신규 등록 | 등록한 자료의 추출·색인만 실행 |
| 공용 템플릿 신규 등록 | 등록한 템플릿의 추출·검증만 실행 |
| LLM Provider 설정 수정 | 실행 없음 |
| 프로젝트 레퍼런스 재탐색 요청 | Reference Workflow 실행 |
| 템플릿 재추천 요청 | Template Workflow 실행 |
| PPT 생성 요청 | Presentation Workflow 실행 |
| PPT 재생성 요청 | 지정 범위만 재생성 |
| 슬라이드 수정 요청 | Slide Revision Workflow 실행 |

설정 저장과 Workflow 실행을 API·UI에서 구분한다. 이미 실행 중인 Workflow의 가이드·Provider 설정을 저장 시점에 바꾸지 않는다.

## 12.1 백그라운드 실행 구조

```text
Rust Runtime
  ├── HTTP Request Handling
  ├── SSE Publisher
  ├── Job Scheduler
  ├── LLM Request Dispatcher
  └── CPU Process Supervisor
       ├── LibreOffice
       ├── PDF Renderer
       ├── Kordoc
       └── PPT Master
```

일반 HTTP 요청은 문서 변환이나 PPT 생성이 끝날 때까지 블로킹하지 않는다. CPU 집약 작업은 제한된 자식 프로세스에서 실행한다.

## 12.2 초기 실행 제한

| 작업 | 초기 동시 실행 상한 |
| --- | --- |
| 문서 PDF 변환 | 2 |
| PDF 렌더링·추출 | 2 |
| OCR | 2 |
| 템플릿 추출 | 1 |
| PPT 렌더링·조립 | 1 |
| 외부 AI 요청 | 연결별 Admin 처리 설정, 기본 동시 4개·대기 32개 |
| 전체 PPT 생성 Workflow | 2 |

초기 기본값이다. 실제 Pod에 할당된 CPU·메모리와 작업 부하를 측정하여 조정한다. 30명 동시접속 검증은 [Phase 7](09-operations-delivery.md)에서 수행한다.

## 12.3 SQLite 동시성

기본 설정은 다음과 같다.

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = FULL;
```

- 쓰기 작업은 짧은 트랜잭션으로 처리한다.
- 긴 LLM 호출이나 LibreOffice 실행 중에는 SQLite 쓰기 트랜잭션을 유지하지 않는다.
- 내부 DB 쓰기는 직렬화된 Writer를 활용한다.
- 읽기는 별도의 제한된 Connection Pool을 사용할 수 있다.
- DB는 WAL을 지원하는 로컬 또는 적합한 블록 스토리지에 둔다.
- 일반적인 네트워크 파일시스템을 통한 WAL 공유는 사용하지 않는다.

## 12.4 장애 복구

- 작업별 Lease 및 Heartbeat 기록
- 프로세스 종료 시 작업 상태 보존
- 재시작 후 실행 중단 작업 탐지
- 선행 작업 결과 재사용
- 실패 노드부터 재실행
- 재시도 상한 관리
- 실패 원인 기록
- 취소 요청 처리
- 미완료 임시 파일 정리
- Workflow 이벤트 이력 유지

SSE 재연결 시 영속 이벤트 ID를 사용해 놓친 이벤트를 이어받는다. 지원하지 않는 Node 버전이 있으면 임의의 새 그래프로 실행하지 않고 [호환성 오류](09-operations-delivery.md)를 표시한다.

## 검색 결과와 PPT 원본 객체 삽입 계약

Studio의 근거·템플릿 단계는 검색 결과를 검토하는 단계다. 파일명 검색과 파일 내부 텍스트·이미지 설명·차트 데이터/축·장표 제목·레이아웃 슬롯 검색을 함께 제공한다. 검색 결과는 파일 결과와 콘텐츠 결과를 구분하고 같은 원본으로 묶는다. 썸네일, 원본 쪽/장표, 일치 부분, 버전과 삽입 가능 형식을 함께 전달한다. 추출 실패·검색 결과 없음·처리 중인 항목도 구분한다.

에이전트에는 `search_assets(query, scope, kinds)`, `inspect_asset(asset_version_id, component_id)`, `propose_asset_insertion(...)`를 명시적으로 등록한다. 파일 시스템 경로나 임의 스크립트는 노출하지 않는다. 검색은 프로젝트/공용 범위와 버전 접근 조건을 서버에서 강제한다.

삽입 대상은 이미지, 차트, 장표 전체다. 삽입 제안은 source_blob_hash, asset_version_id, extraction_version, component_id, source_slide_number, target_slide_id, insertion_mode, bbox/slot, dependency_artifact_ids를 포함한다. 이미지 원본 바이트, 편집 가능한 차트의 데이터·스타일·내장 workbook, 장표의 master/layout/theme/font/media/relationship 의존성을 함께 보존한다. 파일 선택은 근거 범위 지정이며 파일 전체를 무조건 붙여 넣는 동작이 아니다.

원본 장표 복사, 편집 가능한 차트 복사, 이미지 삽입을 구분한다. 편집 가능 객체 복사 실패 시 래스터 이미지로 조용히 대체하지 않는다. 대체 가능 여부와 편집성 손실을 표시하고 사용자 선택을 받는다. 잘못된 외부 relationship·OLE·매크로는 실행하지 않으며 안전한 의존성만 가져온다.

검색/삽입은 원본을 변경하지 않고 새로운 SlideSpec 리비전 후보를 만든다. 생성 시작 시 선택 자산과 버전을 고정하고, 삽입 검증 후 사용자 검토를 거쳐 확정한다. 에이전트가 후보를 찾고 배치하도록 하되 근거와 삽입 계획을 기록한다. 실제 PPTX 객체 추출·삽입 Adapter와 관련 검증은 향후 구현이다.

## Space 자산 목적별 실행 계약

템플릿은 PPT Master 템플릿 추출 → 편집 구조·원본 관계 보존 → 장표 PNG 미리보기 저장으로 완료한다. 레퍼런스 본문 추출과 목차 판정 노드를 호출하지 않는다. 레퍼런스는 검증된 파일 형식으로 PPTX 템플릿 추출 가능 여부 확인 → 내용 추출 → 선택된 Decision 연결을 통한 목차 분류 순서로 처리한다. 이 판별이 레퍼런스를 템플릿으로 자동 등록하지 않는다.

현재 제품의 두 문서 처리 실행 슬롯은 공통 Rust 엔진과 SQLite 작업·lease·완료 배치 체크포인트를 사용한다. 취소된 작업의 뒤늦은 결과는 확정하지 않으며 완료한 템플릿 구조와 미리보기는 원본 버전에 연결한다. 문서는 추출·분류·준비, 템플릿은 추출·준비의 독립 그래프를 사용하며 PPT 생성도 공통 엔진에 연결되어 있다. UI에는 개발 검증 단계를 노출하지 않고 준비 상태와 실제 자산 미리보기를 제공한다.

## 사용자 경험 적용 범위

노드·분기·체크포인트·판정 결과는 내부 실행 기록이다. UI에는 안전한 진행 요약과 취소·재시도 가능 여부만 전달한다. Studio의 단계는 사용자 확인 단계이며 실행 그래프와 구분한다. 공통 기준은 [일반 사무직을 위한 사용자 경험 계약](07-ui-design.md#일반-사무직을-위한-사용자-경험-계약)을 따른다.

## 연결별 요청 처리 설정

모델 호출은 연결별 유한 FIFO 대기열을 사용한다. 포화 시 새 요청을 거부하고, 대기 timeout·취소·종료 시 자리를 반환한다. 한도를 낮춰도 수락한 요청을 버리지 않으며 한도 증가 시 가능한 대기 요청을 진행한다. 모델 설정은 대기 전에 고정한다. 이 메모리 대기열과 영속 문서 작업 큐는 별도 책임이다.

레퍼런스 PPTX의 Document 추출 단계는 Kordoc 본문과 PPT Master 네이티브 재사용 자료를 준비한다. 자료 인덱스는 extraction checkpoint와 원자적으로 확정하고 분류는 그 뒤에 수행한다. 템플릿 업로드는 기존 템플릿 전용 경로를 유지한다. 레퍼런스용 네이티브 준비는 template_items/template_extractions를 생성하지 않는다. 구버전 결과의 재사용 자료 보강은 명시적인 새 처리 요청으로만 실행한다.


## 구현된 관계 검색 실행

검색 요청 → 원본/가이드/후보/출처 snapshot → 모델 설정 대기 또는 고정 → 완료 판정 재사용 → 미완료 후보 병렬 판정 → 후보별 checkpoint → 결과 조회/사용자 선택 순서다. 한 영속 검색 실행 안에서 최대 4개의 요청을 동시에 처리하고 연결별 한도를 추가로 적용한다. Native는 후보별 최소 문맥, LLM은 8개 이하/입력 예산 이하 묶음을 사용한다. 전체 corpus를 모델에 전송하거나 모든 문서 쌍을 전수 비교하지 않는다. 검색 정의·모델 설정을 재개 시 유지하며 부분 실패/취소 후 완료 판정을 다시 생성하지 않는다.


### 구현된 목차 생성·매핑 작업

목차 작업은 명시적 generate/map 요청으로 생성한다. 확인된 원본·가이드·모델 config·기준 목차·정의 버전을 고정하고 원문 ID 목록을 스냅샷으로 연결한다. 배치 성공 결과와 요청 ID를 체크포인트로 저장하며 모든 검증 후 새 리비전을 원자적으로 적용한다. 종료·취소·재시작·lease 만료·CAS 충돌을 처리하고 완료된 배치를 반복 호출하지 않는다. 입력 변경이나 동시 편집 시 이전 결과를 덮어쓰지 않는다. 범용 DAG 엔진 구현과는 구분한다.

### 관계 검색의 작업 공간 확장

새 검색은 후보를 지속적인 작업 공간으로 관리하고 정보 부족·조건 차이에는 주변 문맥과 다른 자료의 근거를 제한적으로 공급한다. 해결되지 않은 조건은 선택적 LLM의 추가 질의 또는 실제 원문 단어로 재검색한다. 기존 자료를 유지하고 새 후보만 추가해 평가한다. 시간·후보·읽기·회차 한도로 종료하며 불충분한 종료는 부분 결과로 표시한다.

v2는 초기 비교 → 주변 문맥 재검토 → 최대 3질의의 추가 검색/비교를 지원한다. 임의 셸 대신 정본 참조와 허용된 조회 도구를 사용한다. v1 실행에 새 그래프를 자동 적용하지 않는다. 상세 한도는 [구현 계약](../dev-docs/04-data-api.md#v18-검색-작업-공간)을 따른다.

### PPT 생성 Worker 구현 경계

대화 수정은 기존 생성 Worker와 별도의 영속 편집 요청으로 선택한 장표의 텍스트·이미지·차트·도형·배치를 처리한다. 하나의 `propose_slide_patch` 구조화 명령을 서버에서 선택 범위와 대조하고, 사용자 검토/적용 후 변경 Spec과 새 deck rendering run을 만든다. 미변경 slide version은 재사용하되 전체 PPTX 조립·검증을 수행한다. 최대 24개 선택 장표의 제안을 개별 checkpoint하며 전체 검토 후 원자적으로 적용한다. 네이티브 다중 도구 에이전트와 캔버스 직접 드래그는 후속 구현이다. 실제 테이블/API는 [V20 계약](../dev-docs/04-data-api.md#v20-슬라이드-대화-수정)을 따른다.

PPT generation now uses the common write → render → publish engine. Slide specs, rendered output and publication have durable checkpoints; publication and head advancement remain atomic. Other worker migration, parallel nodes, dynamic branches, visual-model repair and changed-slide-only rendering remain follow-on work.

## Common engine implementation boundary

Presentation generation uses the versioned write → render → publish graph. Generic dependency execution, bounded admission, heartbeat/cancellation supervision and durable node/event/artifact checkpoints are implemented. Feature adapters retain canonical job/input ownership and fence every commit with the job lease. Render output and render-node success commit together; publication and publish-node success commit together.

Document/template preparation also consumes the common engine: document extract → classify → ready and template extract → ready, with two shared processing slots independent of the one-slot PPT engine. Space and Studio expose committed stages and explicit cancellation/retry; restart reuses completed extraction and decision batches. OCR remains within extraction rather than an independent per-page checkpoint. Outline generation and content mapping also use separate compose → publish and map → publish graphs, with a shared one-slot outline engine. Canonical batch responses are reused after interruption; final batch and work-node success are atomic, and publication/head advancement and publish-node success are atomic. Relation discovery uses retrieve → review → publish with bounded feature-owned parallel comparisons/exploration. Chat proposals use propose → render, with explicit user approval outside generic execution followed by normal PPT publication. Parallel-node execution, dynamic branches, general human gates, unified workflow APIs/SSE and an Admin monitor are not yet implemented. Persistence contracts are documented in [execution checkpoints](../dev-docs/04-data-api.md#v23-workflow-execution-checkpoints) and [outline checkpoints](../dev-docs/04-data-api.md#v25-outline-generation-and-mapping-checkpoints).

## Reference-enabled generation and editing

Initial generation pins source material IDs, preserves the original model draft and applies references once before rendering. Editor insertion creates a render-only immutable revision with unchanged slides reused. Chat proposals freeze available source IDs, checkpoint each target and render real previews before explicit approval. Native PPTX reference parts and chart workbooks are retained; generic source handling never grants arbitrary filesystem/process/SQL tools. [Current contracts](../dev-docs/04-data-api.md#v27-pinned-native-reference-insertion) define actual limits and remaining format fidelity gaps.

## 장표별 품질 실행 계약

공통 render 노드 내부에서 장표마다 작성 Spec, 목적 위치, 템플릿·원본·런타임 버전에 따른 결과를 저장한다. 재시도와 변경 편집은 통과한 장표의 네이티브 PPTX·PNG를 재사용하고 누락·변경한 장표만 렌더링한다. 모든 장표가 통과하면 원본 테마·차트·워크북을 보존하여 조립하고 기존 버전 검사로 확정한다. 원본과 확정 리비전은 재시도·캐시 정리로 삭제하지 않는다.

검사는 해당 장표의 텍스트 누락, 근거 연결, 보수적인 글자 배치 추정, 관리 객체의 경계, 이미지 비율과 네이티브 내용 보존을 포함한다. 배경·도식 겹침은 경고로 구분하며 의미 정확도나 시각 모델의 평가를 대신하지 않는다. 일반 사용자에게 장표 번호와 필요한 조치를 알려주고, 운영 상세 코드와 내부 캐시 구조는 노출하지 않는다.

원본 문서의 분류 노드는 블록별 목차 판정 이후 실제 페이지 ID에 대목차를 연결한다. 텍스트 기반 선택형 Decision 요청에 목차 후보, 현재·인접 페이지 발췌와 앞서 확인한 번호 차이를 제공한다. 실제 파일 순서에는 표지·간지도 포함하며 인쇄 쪽수·근거·장 경계·미확정 상태를 분리한다. 판정 결과는 처리 작업과 고정 모델 설정에 귀속되고 중단 시 저장된 요청 결과부터 재사용한다. 발표 목차 구성은 별도 작업이다.

고정 페이지 문서의 목차 판정은 페이지 문맥을 한 번만 전송한다. 원문 차례의 대목차와 중목차를 부모·자식으로 보존하고, 본문의 장 표제와 경계를 우선 연결한 뒤 불분명한 페이지만 의미 판정한다. 원문 계층은 발표자료용 새 목차와 독립적이다.
