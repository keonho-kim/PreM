# PreM Folio captures

## 중앙 비교·되돌리기

[수정안과 이전 장표 비교](presentation-proposal-before.png) / [확정 후 누름 비교](presentation-published-before.png) / [되돌린 장표](presentation-undo.png)

비교·되돌리기는 확대 버튼 왼쪽의 아이콘으로 제공한다. 비교는 누르는 동안만 표시하고, 되돌리기는 현재 편집 세션의 최근 3단계까지다. Home으로 이탈하면 서버의 되돌리기 참조 캐시가 삭제되는 실제 브라우저 검증을 포함한다. 확정 PPT 파일은 보존된다.

## 제품 객체·일괄 수정

[객체 수정안](object-proposal.png) / [이미지·차트·도형 적용](object-edited.png) / [모바일 객체 대화](object-phone.png)

[Ornith 수정안](ornith-object-proposal.png) / [Ornith 적용 결과](ornith-object-edited.png) / [Ornith 모바일](ornith-object-phone.png)

격리된 실제 서버와 합성 문서로 이미지 등록, 두 장표 수정안 검토·한 번에 적용, 객체 선택을 확인한다. 합성 모델의 기본 캡처와 `ornith-` 접두사의 실모델 캡처를 구분한다. 생성한 차트는 PPTX 내부 데이터와 함께 편집 가능하며 캔버스 드래그 조작은 이 구현 범위가 아니다.

2026-11-15 / current Folio app: Home, Studio review stepper, Space processing, and Admin preview; light only.

Desktop: 1440px wide. Phone: 390px wide. Full page screenshots preserve scrollable page content; internal editor panels retain their visible viewport.

| Screen | Desktop | Phone |
| --- | --- | --- |
| Home | [PNG](screens/PreM--view-projects-project-platform-desktop.png) | [PNG](screens/PreM--view-projects-project-platform-phone.png) |
| 프로젝트 개요 | [PNG](screens/PreM--view-overview-project-platform-desktop.png) | [PNG](screens/PreM--view-overview-project-platform-phone.png) |
| 원본 문서 | [PNG](screens/PreM--view-documents-project-platform-desktop.png) | [PNG](screens/PreM--view-documents-project-platform-phone.png) |
| 작성 방향 | [PNG](screens/PreM--view-guide-project-platform-desktop.png) | [PNG](screens/PreM--view-guide-project-platform-phone.png) |
| 목차 정리 | [PNG](screens/PreM--view-outline-project-platform-desktop.png) | [PNG](screens/PreM--view-outline-project-platform-phone.png) |
| 참고 자료 찾기 | [PNG](screens/PreM--view-references-project-platform-desktop.png) | [PNG](screens/PreM--view-references-project-platform-phone.png) |
| 템플릿 탐색 | [PNG](screens/PreM--view-templates-project-platform-desktop.png) | [PNG](screens/PreM--view-templates-project-platform-phone.png) |
| PPT 생성과 목록 | [PNG](screens/PreM--view-presentations-project-platform-desktop.png) | [PNG](screens/PreM--view-presentations-project-platform-phone.png) |
| PPT 편집기 | [PNG](screens/PreM--view-editor-project-platform-deck-deck1-desktop.png) | [PNG](screens/PreM--view-editor-project-platform-deck-deck1-phone.png) |
| 작업 이력 | [PNG](screens/PreM--view-history-project-platform-desktop.png) | [PNG](screens/PreM--view-history-project-platform-phone.png) |
| AI 연결 | [PNG](screens/PreM--view-admin-project-platform-tab-providers-desktop.png) | [PNG](screens/PreM--view-admin-project-platform-tab-providers-phone.png) |
| 업무별 AI | [PNG](screens/PreM--view-admin-project-platform-tab-routing-desktop.png) | [PNG](screens/PreM--view-admin-project-platform-tab-routing-phone.png) |
| Space 참고 자료 | [PNG](screens/PreM--view-space-project-platform-tab-references-desktop.png) | [PNG](screens/PreM--view-space-project-platform-tab-references-phone.png) |
| Space 템플릿 | [PNG](screens/PreM--view-space-project-platform-tab-templates-desktop.png) | [PNG](screens/PreM--view-space-project-platform-tab-templates-phone.png) |
| 작업 현황 | [PNG](screens/PreM--view-admin-project-platform-tab-monitor-desktop.png) | [PNG](screens/PreM--view-admin-project-platform-tab-monitor-phone.png) |
| 서비스 상태 | [PNG](screens/PreM--view-admin-project-platform-tab-system-desktop.png) | [PNG](screens/PreM--view-admin-project-platform-tab-system-phone.png) |

[Generation dialog](generation-dialog.png) / [Revision comparison](revision-comparison.png)

All screens remain light when the browser is emulating a dark OS preference.

[Document gallery viewport: desktop](document-gallery-desktop.png) / [phone](document-gallery-phone.png)

Offscreen gallery previews remain placeholders until approached. Full-page images record this initial lazy state.

[LLM 모델 연결](admin-model-discovery-llm.png) / [Decision 모델 조회](admin-model-discovery-decision.png) / [모바일](admin-model-discovery-phone.png)

현재 본개발 Admin의 LLM / Decision 탭이다. 연결 정보를 입력해 네이티브 목록을 조회한 후 모델을 선택한다. Decision 캡처는 실제 LM Studio의 D3 Flash 조회 결과를 선택한 상태이며 설정 저장이나 모델 로드는 실행하지 않았다. 이전 admin-model-settings 캡처는 현재 등록 흐름의 기준이 아니다.

[레퍼런스 그림 자료](reference-artwork.png) / [여러 장표 선택 보기](reference-selected-slides.png) / [모바일](reference-artwork-phone.png)

실제 PPTX에서 추출한 이미지·배경·차트·그룹 도식과 장표를 보여준다. 선택 검토 화면이며 PPT 생성이나 삽입 완료 화면은 아니다.


[Studio 시작](studio-empty.png) / [프로젝트 원본](studio-sources.png) / [원본 페이지](studio-document-pages.png) / [작성 방향](studio-direction.png) / [모바일](studio-sources-phone.png)

실제 제품 서버의 프로젝트 원본 업로드·추출·파일 교체 및 선택적 Do/Don’t 저장 화면이다. 자료는 격리된 QA 저장소의 fixture다. 목차·내용 작성 화면은 아래 캡처에서 확인하며 PPT 생성 단계는 아직 구현하지 않았다.


[모바일 작업 패널 펼침](upload-panel-mobile-390-expanded.png) / [접힘](upload-panel-mobile-390-collapsed.png) / [닫힌 뒤 다시 열기](upload-panel-mobile-390-hidden.png)

실제 390px viewport 캡처다. 패널은 화면 하단에 밀착하며 본문 마지막 버튼을 패널 위까지 스크롤할 수 있다. `upload-panel-mobile-before.png`는 수정 전 위치를 재현한 비교 자료다.


[과거 업무 자료 검색](related-documents-desktop.png) / [소속 프로젝트](related-document-projects.png) / [선택한 자료](related-documents-selected.png) / [모바일](related-documents-phone.png)

본개발의 관계 검색 화면이다. 격리된 QA 원본과 검증용 native Decision 서버를 사용한 계약/동작 검증이며 실제 사내 문서의 의미 정확도 검증은 아니다. 선택된 과거 파일 버전과 프로젝트 연결을 보존한다.

[vLLM-SR 연결 및 판정](admin-vllm-sr.png)

실제 Admin 화면과 격리된 로컬 계약 서버의 합성 결과다. 전용 Provider 선택, 모델 목록 조회 및 판정 흐름을 검증하며 공개 호스팅이나 실제 모델 추론의 검증 자료는 아니다.


[Space Markdown 조회](space-markdown.png) / [Studio Markdown 모바일](studio-markdown-phone.png)

합성 Markdown 원본을 실제 제품 서버에서 처리한 화면이다. HTML·외부 이미지 실행 없이 본문·코드·표 텍스트를 확인하며, 모델 미설정 상태에서도 추출 결과는 조회할 수 있다.


[Space 통합 검색](space-search-desktop.png) / [모바일 검색](space-search-phone.png) / [검색 결과의 문서 페이지](space-search-document.png)

실제 제품 서버와 합성 레퍼런스·템플릿으로 확인한 검색 흐름이다. 프로젝트 원본은 제외하며 제목·본문 일치, 기본 접힘 조건, 정상 페이지 이동과 검색 복귀를 확인했다.


[Studio 목차·내용 작성](studio-outline-authoring.png) / [모바일](studio-outline-phone.png) / [병합 표와 추출 이미지](extracted-table-images.png)

본개발 서버에서 목차 생성·수동 편집·원문 연결·확정·이력을 검증한 화면이다. 격리된 QA 저장소와 합성 AI 응답을 사용했으며 실제 모델의 의미 정확도를 검증한 자료는 아니다. 표와 이미지는 공개·합성 회귀 문서의 실제 추출 결과다.


[목차 모바일 내용](studio-outline-phone-content.png) / [목차 편집](studio-outline-edit-phone.png) / [내용 담기](studio-outline-picker-phone.png)

본개발 목차 화면은 가로 목차 선택과 사용할 내용/원문 근거의 두 영역을 사용한다. 목차 편집과 내용 담기는 별도 대화상자이며 AI 구성은 접을 수 있다. 데스크톱·모바일 캡처는 격리된 QA 서버에서 완료된 업로드 항목을 정리한 상태다.

[추가 검색 모델 설정](related-exploration-settings.png) / [추가 근거와 원문 문맥](related-exploration-evidence.png) / [모바일](related-exploration-phone.png)

격리된 실제 제품 서버와 합성 모델로 작업 공간 확장, 다른 문서 발견, 원문 문맥 지연 조회와 출처 미리보기를 확인했다. 실제 업무 문서의 의미 정확도 검증은 아니다.

[Space 검색 홈](space-search-home.png) / [Space 검색 결과](space-search-desktop.png) / [Studio 근거 검토](related-exploration-evidence.png)

Space는 검색 홈과 뉴스형 결과·문서 상세를 제공하며 업로드·관리는 자료 관리로 연결한다. Studio 근거는 선택한 근거/추가 검색과 후보 목록·원문/비교 자료의 검토 영역으로 구성한다. 격리된 실제 제품 서버와 합성 자료를 사용한 캡처다.

근거 검토는 데스크톱에서 화면 높이에 맞춘 두 패널을 제공한다. 모바일은 [후보 목록](evidence-mobile-list.png)과 [원문 상세](related-exploration-phone.png)를 전환하며, 내부 스크롤 없이 읽고 목록으로 돌아갈 수 있다.

## 실제 PPT 생성

[템플릿 선택](presentation-templates.png) / [생성 결과](presentation-generated.png) / [모바일 결과](presentation-generated-phone.png)

격리된 제품 서버·합성 LLM으로 업로드부터 생성까지 실행한 화면이다. 장표 이미지는 실제 PPTX를 PPT Master로 재추출한 PNG다. 다운로드 QA 파일은 tests/.artifacts에 있으며 실제 프로젝트 자료를 사용하지 않는다.

## 제품 Admin 접근

[Admin 토큰 입력](admin-token.png) / [모바일 토큰 입력](admin-token-phone.png)

실제 서버의 토큰 검증 화면이다. 캡처에는 발급된 토큰을 포함하지 않는다. 독립 정적 목업의 역할 미리보기는 이 보안 경계와 다르다.

[Admin 일반 설정의 토큰 변경 확인](admin-general.png): 현재 서버 실행 동안만 적용하며 재시작 시 새 CLI 토큰으로 초기화한다. 입력값은 가려져 있고 실제 운영 토큰을 사용하지 않은 합성 테스트 화면이다.

## Studio 작업 영역

[제품 3단 작업 영역](presentation-generated.png) / [좌우 패널 접기](presentation-panels-collapsed.png) / [우측 참고 자료](presentation-reference-panel.png) / [모바일](presentation-generated-phone.png)

[목업 편집 화면](mock-studio-editor.png) / [목업 모바일](mock-studio-editor-phone.png)

모든 Studio 단계의 Stepper를 유지하며 좌우 패널은 독립적으로 접을 수 있다. 제품 우측 패널은 실제 AI 대화 수정·내용·메모·원문 근거를 표시하고, 목업의 채팅/객체 편집은 시뮬레이션으로 구분한다. 제품 캡처는 격리된 서버와 합성 자료로 생성한 실제 PPTX 미리보기다.

## 제품 대화 수정

[Ornith 수정안 검토](ornith-slide-proposal.png) / [적용 후 장표](ornith-slide-edited.png) / [모바일 대화](ornith-slide-chat-phone.png)

격리된 서버의 합성 발표자료에 Ornith가 실제 응답한 제목 수정이다. 초안은 계약 테스트 모델로 준비했으며 제목 수정만 로컬 LM Studio Native API를 호출했다. 실제 업무 문서나 인증정보는 포함하지 않는다.

## 제품 문서 준비 단계

[설정 대기](document-engine-waiting.png) / [업로드한 탭의 진행 패널](document-engine-panel.png) / [모바일 진행 패널](document-engine-panel-phone.png) / [Studio 원본](studio-document-engine.png) / [분류 중](document-engine-classifying.png) / [강제 종료 후 복구](document-engine-recovered.png)

실제 제품 서버·격리 저장소·합성 문서와 로컬 계약 모델로 확인했다. 다른 브라우저에도 준비 결과를 공유하되 전송 패널은 업로드한 탭에서만 보인다. 모델 정확도나 운영 부하 검증을 대신하지 않는다.

## 제품 목차·내용 연결 실행

[내용 연결 중](outline-engine-mapping.png) / [취소 후](outline-engine-cancelled.png) / [강제 종료 후 복구](outline-engine-recovered.png) / [모바일](outline-engine-phone.png)

실제 제품 Studio·격리 저장소·합성 업무 문서와 계약 모델로 확인했다. 작업 단계는 Studio의 여섯 검토 단계와 구분하며 자동 작업 완료가 사용자의 최종 검토를 대신하지 않는다.

## Reference-enabled PPT generation and conversation

[Visual source selection](reference-selection-dialog.png) / [Native chart/image generation](reference-generated-native.png) / [Reviewed reference-object edit](reference-chat-proposal.png) / [Mobile editor](reference-editor-phone.png) / [Exact source version](reference-source-version.png)

These are real product UI captures from isolated storage and synthetic source/model fixtures. They cover explicit generation choices, additional source slides and approved object placement edits; they do not establish arbitrary Office effect/font fidelity or live model quality.

## 장표별 확인과 렌더링 재사용

[장표 확인 결과](presentation-quality-desktop.png) / [생성된 네이티브 장표](reference-generated-native.png) / [대화 수정안](reference-chat-proposal.png) / [모바일 편집](reference-editor-phone.png)

실제 서버와 합성 자료로 장표별 검사 결과, 이미 확인한 장표의 재사용, 원본 차트·이미지 삽입과 변경한 객체만의 수정안을 확인한다. 화면은 고정 코드의 검사 결과를 업무 언어로 보여주며 정밀한 폰트 조판·시각 모델 평가를 뜻하지 않는다.

## 직접 작성 캔버스

[템플릿 빈 장표](canvas-template-blank.png) / [드래그 중 실제 그림](canvas-drag-live.png) / [직접 편집과 장표 구성](canvas-direct-editing.png) / [모바일](canvas-direct-phone.png)

실제 제품 서버와 합성 템플릿을 사용하는 브라우저 검증 화면이다. 목업 시뮬레이션과 구분하며 임의 원본 PPT 객체의 모든 내부 구조를 직접 편집할 수 있다는 뜻은 아니다.

## 생성할 목차 선택

[본문의 목차·작성 입력](presentation-scope-desktop.png) / [모바일](presentation-scope-phone.png) / [생성된 PPT 편집](presentation-inline-editor.png)

실제 제품 서버와 합성 문서로 부분 선택, 하위 목차 일괄 선택, 키보드·모바일 조작과 선택한 중목차 한 장의 PPTX 출력을 검증한다. 별도 생성 설정 버튼이나 작성 AI 선택란 없이 본문에 생성 범위와 예상 장표 수를 보여주며 선택만으로 작업을 실행하지 않는다. 생성된 자료는 캔버스를 먼저 보여주고 추가 생성 입력은 그 아래에 둔다.

## 공개 원본과 실제 모델

[모델별 출력 한도](output-budget-admin.png) / [Ornith 템플릿 생성](ornith-public-template.png) / [대화 수정 적용](ornith-public-edited.png)

W3C 공식 배포 PDF와 PPTX를 격리된 제품 서버에서 처리하고 실제 Ornith로 작성·수정한 화면이다. 공개 원본의 출처·해시는 `tests/fixtures/presentation-public.json`에 고정한다. 자동 생성 내용은 사용자가 검토하는 초안이며 회사 서식·모든 입력 문서의 내용 정확도를 인증한 화면은 아니다. 원본·산출물과 검사 보고서는 `tests/.artifacts/`에 둔다.


[생성 목차의 수정·추가 아이콘](generation-outline-actions.png)

생성 화면 목차 행에서 제목·순서를 수정하고 중목차를 추가한 실제 제품 화면이다. AI/직접 작성 탭은 제공하지 않는다.
