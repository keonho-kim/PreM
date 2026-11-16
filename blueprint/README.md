# PuPuTyX

엔터프라이즈 AI 문서 분석 및 프레젠테이션 생성 플랫폼

PuPuTyX 통합 제품·기술 설계서 v2.0

이 문서 모음은 기획·아키텍처팀의 통합 설계서 v2.0을 주제별로 재구성한 구현 기준이다. 원문의 기능, 제약, 데이터 보존 정책, 검증 기준을 유지한다. UI 디자인은 **Hallmark Furrow를 문서·근거·슬라이드 작업에 맞춘 Folio 웹앱**을 기준으로 구체화한다. 전체 디자인을 맡긴 최신 요청에 따라 Refract·타일·글래스 방향을 대체한다.

현재 운영 범위는 같은 회사 내 우리 팀의 공용 도구다. 판매·고객사 배포·외부 SaaS는 목표에 포함하지 않는다. 의존성은 내부 사용의 기능 적합성과 운영 편의성을 우선하며, 상업용 고객 재배포 조건을 미리 강제하지 않는다.

프로젝트명과 제품명은 **PuPuTyX**이며, 실행 파일명도 `PuPuTyX`로 통일한다. 이 문서는 구현 완료를 의미하지 않으며, 의존성의 실제 버전·배포 가능 여부·라이선스 적합성은 릴리스 검증 대상이다.

## 문서 색인

| 문서 | 범위 | 원문 대응 |
| --- | --- | --- |
| [제품 개요와 시스템 계약](README.md) | 제품 정의, 기본 요구사항, 핵심 원칙, 최종 계약 | 1장, 17장 |
| [배포 및 실행](01-deployment-runtime.md) | 단일 실행 명령, 초기화, 환경변수, 릴리스 패키지, 저장 경로 | 2장 |
| [본개발 소스 아키텍처](02-system-architecture.md) | 계층 구조, 기술 의존성, 외부 도구, 개발 도구, 디렉터리 구조 | 3장, 15장 |
| [사용자 기능](03-product-features.md) | 프로젝트, 문서, 가이드, 목차·매핑, 라이브러리, PPT 생성·편집 | 4장 |
| [Workflow와 동시성](04-workflow-engine.md) | Durable DAG, 개별 Workflow, 재실행, 자원 제한, 장애 복구 | 5장, 12장 |
| [데이터 모델과 파일 저장](05-data-storage.md) | SQLite 테이블, 정규화, 리비전, Blob, 원본 보존·무결성 | 6장, 7장 |
| [LLM Gateway와 Admin](06-llm-admin.md) | Provider, Tool Calling, 설정 버전, 동적 반영, 모델 라우팅 | 8장 |
| [UI 및 Folio 디자인](07-ui-design.md) | 메뉴, 화면별 구성, 디자인 토큰, 상호작용·접근성 | 9장, 현재 Folio 기준 |
| [REST API](08-rest-api.md) | `/api/v1` 엔드포인트, SSE, 충돌 검사, 멱등성 | 10장 |
| [호환성·운영·개발 검증](09-operations-delivery.md) | Migration, 하위호환, 백업·복구, 보안, 개발 단계·완료 기준 | 11장, 13장, 14장, 16장 |

전체 문서는 이 색인을 포함해 **10개**다. 공통 정책은 담당 문서에 한 번 정의하고 다른 문서에서는 링크로 참조한다. 원문 장 번호는 각 문서의 도입부에 표시한다.

## 1. 제품 개요

### 1.1 제품 정의

PuPuTyX는 회사 내부에 단일 인스턴스로 설치하여 다양한 원본 문서를 분석하고, 콘텐츠를 재구성하며, 레퍼런스와 디자인 템플릿을 활용해 **편집 가능한 PPTX**를 생성하는 AI 기반 문서 제작 플랫폼이다.

RFP 전용 시스템이 아닌 범용 문서 분석·프레젠테이션 제작 시스템으로 구현한다.

### 주 사용자와 제품 표현 원칙

주 사용자층은 **일반 사무직군으로 한정**한다. 보고서, 회의자료, 제안서, 교육자료와 발표자료를 작성·검토하는 사람을 기준으로 설계한다. 파일 업로드·검색·문서 편집 수준의 숙련도를 전제하며 개발, AI 모델 운영 또는 데이터 구조에 대한 지식을 요구하지 않는다. 개발자·모델 연구자용 작업 도구를 일반 사용자 경험의 기준으로 삼지 않는다.

사용자 화면은 해야 할 일, 확인할 결과, 다음 행동을 설명한다. 내부 개발 용어, 처리 로직, 저장 구조, 모델 판정 과정과 진단 정보는 일반 화면·알림·도움말에 노출하지 않는다. 기술 설계 문서의 용어와 내부 API 계약은 유지하고 사용자 표현을 별도로 설계한다. 상세 언어·정보 계층·검증 기준은 [UI 및 Folio 디자인](07-ui-design.md#일반-사무직을-위한-사용자-경험-계약)이 소유한다.

### 1.2 기본 요구사항

| 항목 | 설계 기준 |
| --- | --- |
| 배포 형태 | 사내 팀 공용 단일 설치형 |
| 실행 방식 | 단일 명령으로 서버 실행 |
| 백엔드 | Rust + Axum + Tokio |
| 프론트엔드 | React + TypeScript + shadcn/ui |
| 데이터베이스 | SQLite |
| DB Migration | refinery |
| 동시접속 | 30명 기준 |
| 배포 환경 | 회사에서 제공한 Kubernetes Pod 1개 |
| LLM | 외부 Provider API |
| OCR | Kordoc 내장 OCR |
| PPT 생성 | PPT Master |
| Office 변환 | LibreOffice 및 H2Orestart |
| 사용자 관리 | 미구현 |
| 로그인·권한 | 일반 사용자 로그인 없음; Admin은 시작 시 CLI 임의 토큰 필요 |
| 프로젝트 | 모든 접속자가 공유하는 목록, 프로젝트별 데이터 격리 |
| 업데이트 | 기존 데이터·파일·생성물 유지 |
| 라이선스 | 팀 내부 사용·로컬 실행에 적합한 오픈소스; GPL/MPL/AGPL도 실제 사용 조건에 따라 채택 |

### 1.3 핵심 설계 원칙

1. **Single Source of Truth:** 동일한 업무 데이터의 원본은 한 곳에서만 관리한다.
2. **Immutable Source:** 업로드 원본과 확정된 리비전은 덮어쓰지 않는다.
3. **Normalized Database:** 관계형 데이터는 원칙적으로 제3정규형(3NF)을 적용한다.
4. **Durable Workflow:** 모든 장기 실행 작업은 상태와 체크포인트를 영속화한다.
5. **Explicit Regeneration:** 기존 분석·생성 결과는 명시적인 재실행 요청 없이는 재생성하지 않는다.
6. **Backward Compatibility:** 새 버전은 지원 대상 구버전 데이터와 산출물을 읽고 활용할 수 있어야 한다.
7. **Offline Runtime:** 실행 시 패키지·OCR 모델·외부 프로그램을 다운로드하지 않는다.
8. **Provider Independence:** 비즈니스 로직은 특정 LLM Provider에 종속되지 않는다.
9. **Artifact Lineage:** 모든 생성 결과에서 사용한 원본, 가이드, 템플릿, 근거, 모델 버전을 추적한다.
10. **Single Deployment Unit:** 프론트엔드, 백엔드, 도구 런타임, OCR 모델을 하나의 릴리스 패키지로 제공한다.

외부 LLM API 호출은 설계상 필요하다. Offline Runtime은 실행 시 설치·패키지·모델 다운로드를 금지하는 계약이며, 외부 LLM을 사용하는 구성의 완전한 무통신 실행을 뜻하지 않는다.

## 17. 최종 시스템 계약

| 영역 | 최종 규칙 | 상세 문서 |
| --- | --- | --- |
| 실행 | `./PuPuTyX --data-storage-path <absolute-path>` | [배포 및 실행](01-deployment-runtime.md) |
| 최초 실행 | 경로 확인·생성·DB 초기화·Migration 자동 수행 | [배포 및 실행](01-deployment-runtime.md) |
| 기존 실행 | 데이터 유지·스키마 검증 후 시작 | [배포 및 실행](01-deployment-runtime.md) |
| 프론트엔드 | Rust가 `/home`에서 제공 | [아키텍처](02-system-architecture.md) |
| 애플리케이션 | 단일 Rust 모놀리스 | [아키텍처](02-system-architecture.md) |
| DB | SQLite + refinery | [데이터 모델](05-data-storage.md) |
| Storage | 공통 Blob + 독립 Project/Reference/Template Storage | [데이터 모델](05-data-storage.md) |
| 원본 | 불변·중복 제거·버전 추적 | [파일 저장](05-data-storage.md) |
| OCR | Kordoc 내장 모델, 배포본에 포함 | [아키텍처](02-system-architecture.md) |
| PPT | PPT Master + Kordoc 후처리 | [사용자 기능](03-product-features.md) |
| Workflow | Rust Durable DAG Engine | [Workflow](04-workflow-engine.md) |
| LLM | 7개 Provider, Vision/Tool Calling 지원 | [LLM](06-llm-admin.md) |
| LLM 설정 | Admin UI, 재시작 없이 반영 | [LLM](06-llm-admin.md) |
| 프로젝트 가이드 | 범용·편집 가능·버전 관리 | [사용자 기능](03-product-features.md) |
| 재생성 | 사용자의 명시적 요청에 의해서만 실행 | [Workflow](04-workflow-engine.md) |
| 슬라이드 | 개별 리비전 및 근거 관리 | [데이터 모델](05-data-storage.md) |
| 하위호환성 | Migration + Versioned Schema + 변환 계층 | [호환성·운영](09-operations-delivery.md) |
| 중복 저장 | 정규화된 관계와 Content Hash 기반 중복 제거 | [데이터 모델](05-data-storage.md) |
| 사용자 관리 | 현재 미구현 | [운영·보안](09-operations-delivery.md) |
| 배포 | 단일 빌드본, 회사 제공 Pod 1개 | [배포 및 실행](01-deployment-runtime.md) |

## 문서 적용 규칙

- 동작·데이터 계약은 원문 v2.0을 유지한다. 현재 라이트 웹앱의 구체적인 UI 규칙은 [UI 문서](07-ui-design.md)의 추가 설계다.
- 가이드·Provider 설정 저장과 기존 결과의 재실행을 구분한다. 이미 시작한 Workflow는 시작 당시 입력·설정 버전을 사용한다.
- 공용 자산 등록과 프로젝트 로컬 자산 등록을 구분한다. 프로젝트 업로드만으로 회사 공용 자료가 되지 않는다.
- 문서에 없는 API 요청·응답 스키마, 제한 수치, 보존기간, 지원 버전 범위는 구현 전 확정해야 한다. 임의의 확정값을 추가하지 않는다.
- 원문에 있는 테이블은 주요 필드 수준의 논리 모델이다. 완성된 DDL이나 OpenAPI 명세로 간주하지 않는다.
