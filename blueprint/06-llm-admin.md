# LLM Gateway와 Admin

PreM 통합 제품·기술 설계서 v2.0. 원문 **8장**을 수록한다. [문서 색인](README.md)

현재 구현은 Provider별 네이티브/공식 서버 API의 설정 저장·모델 목록·텍스트/지원되는 구조화 진단과 요청 이력이다. Vision/Tool Calling/스트리밍, 작업별 라우팅·fallback과 문서 처리 Workflow는 아직 구현하지 않았다. 실제 API와 키 계약은 [구현 데이터·API](../dev-docs/04-data-api.md#provider-설정진단-api)를 따른다.

## 8.1 지원 Provider

| Provider | 연결 방식 |
| --- | --- |
| LM Studio | Native `/api/v1/models`, `/api/v1/chat`; 기존 OpenAI 호환 연결 별도 유지 |
| OpenAI | Native Responses API |
| Claude | Anthropic Messages API |
| Gemini | Native `models/{model}:generateContent` |
| llama.cpp | Native `/apply-template` → `/completion`, 모델 조회 `/v1/models` |
| SGLang | Native `/get_model_info`, `/tokenize` → `/generate` |
| vLLM | 공식 OpenAI-Compatible 서버 API |
| LiteLLM | 공식 OpenAI-Compatible Proxy API |

네이티브 연결 실패 시 OpenAI 호환 API로 자동 우회하지 않는다. LM Studio Native에는 문서화된 JSON Schema 생성 옵션이 없으므로 structured 진단은 422로 명시적으로 거부한다. 구조화 출력이 필요하면 사용자가 별도의 LM Studio OpenAI 호환 연결을 선택한다. vLLM·LiteLLM의 공식 기본 HTTP 인터페이스는 OpenAI 호환 형식이며 다른 네이티브 형식이라고 표시하지 않는다.

### 지원 기능

- Text Generation
- Vision
- Tool Calling
- Streaming
- Structured Output
- Reasoning 옵션
- Usage Tracking
- Timeout 및 Retry
- Provider Fallback
- Model Routing

모든 LLM은 Vision과 Tool Calling을 지원하는 구성으로 사용한다고 가정한다. Provider별 실제 메시지·이미지·Tool Call 형식은 Adapter에서 변환한다.

이는 사용할 모델·서버 구성에 대한 요구사항이다. 실제 지원 여부는 Admin의 기능별 테스트와 [Provider Contract Test](09-operations-delivery.md)로 검증한다.

## 8.2 LLM Gateway

```text
Application Service
       ↓
LLM Gateway
       ├── Request Builder
       ├── Provider Router
       ├── Tool Registry
       ├── Vision Adapter
       ├── Schema Validator
       ├── Retry / Timeout
       └── Usage Tracker
                ↓
          Provider Adapter
```

비즈니스 로직은 특정 Provider에 종속되지 않는다. Provider의 고유 요청·응답 형식은 Adapter 경계에서 처리한다.

### System One 형태의 Decision Adapter

기준은 TypeSafe의 [System One HTTP API](https://docs.typesafe.ai/api/system-one)이며, 이름이 비슷한 제3자 호스팅 API와 구분한다. 요청은 `model`, `state`, 이름별 `questions`를 사용하고 응답은 같은 질문 ID로 연결한다. 초기 범위는 텍스트 `state`와 `choice`다. `noul`, `score`, 이미지·box는 실제 소비자가 생길 때 별도 capability와 검증을 추가한다. Admin 샘플 판정과 LLM bridge·9개 native 연결 adapter는 구현했다. 실계정의 외부 서비스 검증, 문서 자동 처리와 영속 판정 Artifact는 미완료다. 지원 API·근거·운영 조건은 [Provider 조사](../dev-docs/08-dependencies.md#system-one--decisions-api-지원-조사)에 기록한다.

```json
{
  "model": "ornith-1.5-35b-a3b",
  "state": {
    "regions": {
      "r1": { "text": "목차\n1. 사업 개요 ... 3\n2. 추진 계획 ... 8" }
    }
  },
  "questions": {
    "toc_r1": {
      "type": "choice",
      "instructions": "state.regions.r1이 문서의 목차 영역인지 판정한다.",
      "criteria": {
        "0": "일반 본문·개별 제목이며 목차 영역이 아니다.",
        "1": "문서의 절·장과 그 위치 또는 순서를 안내하는 목차 영역이다."
      }
    }
  }
}
```

`model`은 선택한 연결의 고정 모델 ID다. 일반 LLM의 모델 이름을 TypeSafe에 그대로 보내지 않고, Jev 연결 시 실제 제공되는 모델 ID를 선택한다. 업무 질문·판정 대상은 유지하되 연결·모델·실행 정책은 서버가 선택하고 기록한다.

- **LLM 구현:** 위 입력을 고정된 판정 지침과 JSON 데이터로 직렬화하고 생성 ModelClient를 사용하되 공통 수명은 model_execution에 맡긴다. decisions 모듈 자체는 inference에 의존하지 않는다. 등록된 질문별 선택지로 응답 schema를 생성한다. 응답 예시는 `{"answers":{"toc_r1":{"type":"choice","choice":"1"}}}`다. 긴 설명, 목차 항목 생성, 모델이 추측한 확률은 요청하지 않는다. 문서 데이터가 지침·허용 선택지를 변경하지 못하게 한다.
- **Jev 구현:** `POST https://api.typesafe.ai/v1/systemone`에 Bearer 인증으로 요청한다. 실제 native choice 응답의 `choice`, `probabilities`, `confidence`, 응답 모델과 usage를 검증·보존한 뒤 같은 내부 판정으로 변환한다. 기존 텍스트 생성 인터페이스로 Jev를 위장하지 않고 좁은 decision 호출 port를 구현한다.
- **호환 범위:** 입력의 선택된 부분집합과 내부 의미 계약을 공유한다. LLM 응답은 native System One 응답 전체와 wire-compatible하다고 표시하지 않는다. 내부 통계는 `unavailable` 또는 `provider_reported`로 출처를 구분하며, 없는 확률·usage를 0이나 1로 채우지 않는다. Provider confidence도 사내 문서에서 측정한 정확도와 동일시하지 않는다.
- **이진 판단:** 공식 [Choice](https://docs.typesafe.ai/primitives/choice)의 선택지는 문자열이다. 초기에는 `"0"`/`"1"`을 도메인 정수로 변환한다. 공식 [Noul](https://docs.typesafe.ai/primitives/noul)은 정수 판정이 아닌 0~1의 yes 확률이므로 추후 도입 시 모델별 검증된 임계값·미확정 구간을 둔다. LLM의 0/1을 Noul 확률로 대체하지 않는다.
- **실행 정책:** 공통 동시성·취소·timeout·요청 이력과 설정 고정을 재사용한다. 지원하지 않는 capability는 호출 전에 거부한다. 외부 서비스로의 자동 fallback이나 자격 증명 재사용은 하지 않는다. 모델 교체 후에는 대표 자료에서 오탐·누락과 호출 비용을 다시 검증한다.

계약 검증은 native 응답 fixture와 LLM 정규화 fixture를 분리해 같은 업무 결과로 매핑되는지 확인한다. 확률 범위·선택지 집합·질문 ID 대응·누락·취소·설정 버전 고정도 포함한다. fixture 검증은 실제 Jev 연결 성공을 증명하지 않으며 외부 연결 검증 전에는 미연동 상태로 표시한다. 자유 텍스트 추출은 판정 API 밖에 둔다.

### Tool Calling 정책

LLM이 호출할 수 있는 Tool은 명시적으로 등록된 기능으로 제한한다.

| Tool 예시 | 용도 |
| --- | --- |
| `read_document_blocks` | 문서 블록 조회 |
| `get_outline` | 목차 조회 |
| `search_references` | 레퍼런스 검색 |
| `search_templates` | 템플릿 검색 |
| `get_template_layouts` | 템플릿 레이아웃 조회 |
| `get_slide_spec` | 슬라이드 Spec 조회 |
| `propose_slide_patch` | 슬라이드 변경안 제안 |
| `validate_slide_spec` | 슬라이드 Spec 검증 |

- 임의의 셸 명령, 임의 경로 파일 쓰기, DB SQL 실행을 LLM이 직접 요청할 수 없도록 한다.
- 모든 Tool의 입력을 JSON Schema로 검증한다.
- 원본 문서와 레퍼런스 본문은 신뢰할 수 없는 데이터로 취급한다.
- 문서의 문구가 시스템 명령이나 Tool 실행 권한을 변경하지 못하도록 한다.

슬라이드 변경 제안은 [Slide Revision Workflow](04-workflow-engine.md)에서 새 Spec에 적용하며 기존 리비전을 덮어쓰지 않는다.

## 8.3 Admin LLM 설정

### 화면 구성

```text
Admin
 └── LLM 설정
      ├── Provider 목록
      ├── Provider 추가
      ├── Endpoint 설정
      ├── API Key 등록
      ├── 연결 테스트
      ├── 모델 등록·조회
      ├── Vision 테스트
      ├── Tool Calling 테스트
      ├── Structured Output 테스트
      ├── 작업별 모델 라우팅
      └── 요청 로그·오류 현황
```

화면 표현은 [라이트 웹앱 UI 설계](07-ui-design.md)를 따른다. LLM Provider 설정은 환경변수 대신 이 UI에서 관리한다.

### Provider 등록 입력

- Provider 종류
- 표시 이름
- Base URL
- API Key 또는 인증 정보
- API 형식
- 모델 ID
- Timeout
- 요청 제한 시간은 5~900초 범위로 검증하며 기존 값은 그대로 보존한다. 문맥 로드 크기·출력 한도·응답 대기 시간을 구분한다.
- 선택적 LLM 출력 한도 (`max_output_tokens`): 256~65,536토큰; 미지정 시 작업별 기본값
- 요청 제한
- 활성화 여부

### 설정 반영 절차

```text
Admin UI
   ↓
설정 수정
   ↓
설정값 검증
   ↓
필요 시 연결 테스트
   ↓
새 Config Version 생성
   ↓
SQLite Transaction Commit
   ↓
LLM Gateway 설정 캐시 갱신
   ↓
새 요청부터 최신 설정 적용
```

서버 재시작은 필요하지 않다. 실행 중인 LLM 요청과 Workflow는 기존 설정 버전을 유지한다. 여기서 새 설정이 적용되는 새 요청은 기존 Workflow에 고정되지 않은 새 실행의 요청을 의미한다.

설정 저장에 실패하면 기존 설정을 그대로 사용한다. Provider 설정 저장만으로 기존 분석·생성 Workflow를 재실행하지 않는다.

### 작업별 모델 라우팅

| 작업 유형 | 라우팅 설정 |
| --- | --- |
| 문서 구조 분석 | 기본 모델, 대체 모델 |
| 목차 생성 | 기본 모델, 대체 모델 |
| 콘텐츠 매핑 | 기본 모델, 대체 모델 |
| 레퍼런스 검색 계획 | 기본 모델, 대체 모델 |
| 레퍼런스 관련성 평가 | 기본 모델, 대체 모델 |
| 템플릿 추천 | 기본 모델, 대체 모델 |
| 슬라이드 스토리라인 | 기본 모델, 대체 모델 |
| 슬라이드 생성 | 기본 모델, 대체 모델 |
| 슬라이드 수정 | 기본 모델, 대체 모델 |
| 시각 품질 평가 | 기본 모델, 대체 모델 |

관리자는 작업별 기본 모델과 대체 모델을 선택할 수 있다. 모델 라우팅 변경도 서버 재시작 없이 반영한다.

### 최초 설치와 LLM 미설정 상태

LLM 설정이 하나도 없어도 서버는 정상 시작해야 한다.

- 문서 업로드 가능
- 관리자 설정 가능
- LLM이 필요한 Workflow는 설정 대기 상태 표시

설정 대기와 실행 실패를 UI에서 구분한다. 상태 표시의 구체적인 문구와 표현은 [UI 상태 규칙](07-ui-design.md)에 정의한다.

### 비밀정보와 요청 기록

API Key는 암호화 저장한다. 복호화된 값은 API 응답과 로그에서 노출하지 않는다. 키 파일 주입 방식과 저장 테이블은 [데이터 모델](05-data-storage.md), 기본 로그의 허용 정보는 [운영·보안](09-operations-delivery.md)을 따른다.


Admin에서는 LLM/System One을 선택한 다음 해당 범주의 연결 방식을 선택한다. OpenAI와 Gemini의 판정 연결도 System One 범주에 있지만 실제 전송은 각각 `/v1/decisions`, `/v1beta/decisions`를 사용한다. 기존 생성 연결은 그대로 유지한다. System One 연결에서 텍스트·구조화 생성 진단은 비활성화하며 서버도 422로 거부한다. 모델 목록에는 판정 미지원 모델이 포함될 수 있으므로 명시적 판정 테스트 성공과 구분한다.

## 사용자 경험 적용 범위

Admin은 AI 연결·업무별 AI·작업 현황 중심으로 구성한다. 연결에 꼭 필요한 이름·주소·인증 정보는 상세 설정으로 두고 내부 프롬프트·판정 스키마·원시 응답은 업무 화면에 노출하지 않는다. 공통 기준은 [일반 사무직을 위한 사용자 경험 계약](07-ui-design.md#일반-사무직을-위한-사용자-경험-계약)을 따른다.

## 연결별 요청 처리 설정

Admin의 각 LLM/System One 연결에 처리 설정 탭을 제공한다. PreM 동시 처리 수(기본 4, 1~1024), 대기 요청 수(기본 32, 0~4096), 최대 대기 시간(기본 30초, 1~600초)을 별도 버전으로 저장한다. 저장 후 재시작 없이 적용하며 실행 중 모델 입력과 완료 결과는 변경하지 않는다. 외부 엔진의 로드 설정은 변경하지 않는다.

LLM 연결 / Decision Model 연결 사이드 메뉴에서 Provider별 입력·모델 조회·선택을 수행한다. 저장 전 조회는 별도 POST API이며 설정을 임의로 생성하지 않는다. 모델명 직접 입력과 별도 추가 버튼은 제공하지 않는다. 모델 목록은 Provider 네이티브 경로와 인증을 따르고, LM Studio는 명시적인 모델 type으로 LLM과 Decision을 분리한다. UI 상세 동작은 [UI 설계](07-ui-design.md)를 따른다.


### 자료 찾기 연결

자료 관계 판정과 문서 구조 분류는 Decision Model 연결의 공통 판정 설정을 사용한다. Admin → Decision Model 연결에서 저장된 native Decision 또는 구조화 LLM 연결을 선택한다. 실행 시 config revision을 고정하고 호출·취소·실패·사용량은 기존 gateway와 model_execution에서 관리한다. 연결 동시성/대기열 변경은 PreM 요청량에만 적용하며 외부 모델 엔진의 context length나 micro-batch 설정을 자동 변경하지 않는다.


### vLLM-SR Decision 연결

vLLM-SR은 일반 vLLM과 별도 Provider ID `vllm_sr_decision`으로 관리한다. Admin → 모델 연결 → Decision에서 주소와 선택적 API Key를 입력해 실제 모델 목록을 조회한 뒤 저장한다. Router 전용 `/v1/systemone/models`와 standalone runtime의 `/v1/models`를 구분하고, 전용 경로가 없는 404/405만 후자의 조회를 허용한다. 인증·과부하·서버 오류를 우회하지 않는다. System Two 채팅 모델은 판정 후보에서 제외한다.

현재 범위는 텍스트 choice 판정이다. 객체 입력은 JSON 문자열로 전송해 로컬/호스팅의 공통 부분을 사용하며 기존 native 응답 검증·설정 고정·동시성·대기열을 적용한다. 모델 목록 조회와 설정 저장은 추론이나 모델 설치를 시작하지 않는다. 기본 주소는 로컬 runtime이며 공개 평가 서비스의 실제 사용 조건과 검증 범위는 [의존성 문서](../dev-docs/08-dependencies.md)에 명시한다.

LM Studio 연결의 컨텍스트 길이와 물리 배치 크기는 Admin의 모델별 설정 버전에 귀속된다. 명시적인 모델 준비가 맞는 인스턴스를 재사용하거나 로드하며, 판정·생성 요청은 고정된 설정에 맞는 인스턴스 ID로 전송한다. [V35 구현 계약](../dev-docs/04-data-api.md#v35-모델별-토큰-설정)을 따른다.
