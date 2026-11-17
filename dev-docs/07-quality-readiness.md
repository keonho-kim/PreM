# 디자인과 접근성

## Folio 디자인 시스템

PreM는 라이트 전용 Folio를 사용한다. 문서 종이와 슬라이드의 내용을 중심으로 중립 배경, 명확한 글자, 제한된 강조색을 적용한다. 테마 전환이나 OS 다크 모드 연동은 제공하지 않는다.

| 역할                  | 값                    |
| --------------------- | --------------------- |
| 작업 배경             | `#F6F5F2`             |
| 콘텐츠 표면           | `#FFFEFA`             |
| 중립 작업 영역        | `#EEEDE8`             |
| 기본 글자             | `#262824`             |
| 보조 글자             | `#51564F`             |
| 약한 글자             | `#60665D`             |
| 주요 명령 배경·글자   | `#F58254` / `#262824` |
| 링크·포커스·선택 강조 | `#9C3D1E`             |
| 필수 컨트롤 경계      | `#7D8177`             |
| 구분선                | `#DCDED6`             |

색상 원본은 [refract.tokens.json](../design/refract.tokens.json)이고 [generate-design-tokens.mjs](../scripts/generate-design-tokens.mjs)가 다음 파일을 생성한다.

- [mock/theme.generated.css](../mock/theme.generated.css)
- [frontend/src/app/styles/theme.generated.css](../frontend/src/app/styles/theme.generated.css)

`pnpm tokens`로 생성하고 `pnpm tokens:check`로 원본과 출력의 일치를 검사한다. 생성 CSS를 직접 수정하지 않는다. 간격·서체 로딩·배치와 상태별 컨트롤 스타일은 각 UI의 소유다.

## 타이포그래피·아이콘

로컬 Red Hat Text는 인터페이스에, Red Hat Display는 제목에 사용한다. 한글은 시스템 글꼴로 대체된다. 반복 보조 명령은 로컬 Lucide 아이콘을 사용하고, 주요 흐름의 실행 버튼은 의미 있는 라벨을 유지한다.

아이콘 전용 버튼에는 접근 가능한 이름, title, 키보드 포커스를 제공한다. 기본 명령 대상은 44px 이상, coarse pointer에서는 48px 이상이다. 버튼 모서리는 8px이며 문서·슬라이드 내용의 색은 앱 토큰과 독립적으로 유지한다.

## 화면 구성

| 영역      | 구성 기준                                                         |
| --------- | ----------------------------------------------------------------- |
| 전역 메뉴 | 고정된 제품 Nav, 현재 위치 표시; 제품 Admin에는 역할 구분 없음    |
| Studio    | 프로젝트 컨텍스트와 원형 마커가 이어지는 단계 표시                |
| 문서      | 페이지 비율을 확보한 갤러리, 근접 페이지의 미리보기 지연 구성     |
| 근거 검색 | 썸네일 왼쪽·제목과 발췌 오른쪽의 행, 실제 문자열 일치 강조        |
| 편집기    | 좌측 슬라이드·중앙 캔버스·우측 대화/Reference                     |
| Space     | 진행 바와 텍스트 상태, Studio Stepper와 구분                      |
| Admin     | 제품 전용 접이식 사이드 메뉴 + 연결 설정·연결 테스트·요청 이력 탭 |

각 화면의 DOM 순서와 시각적 읽기 순서를 일치시킨다. 작은 화면에서는 패널을 쌓고 목록의 스크롤 방향을 조정한다. 숨긴 패널의 버튼은 키보드 탐색 대상에서 빠지며 외부의 다시 펼치기 버튼은 남는다.

## 컴포넌트 기준과 현재 적용 범위

제품 컴포넌트는 공식 shadcn/ui 우선이며 AI UI는 [AI Elements](https://ui.shadcn.com/docs/ai-elements)를 기준으로 설계한다. Folio 시각 토큰은 컴포넌트 공급원과 독립적으로 유지한다. Home은 공식 shadcn registry의 Button·Input·Label·Select·Card·Pagination·Dialog·Alert Dialog·Dropdown Menu·Context Menu·Popover·Calendar를 사용한다. 제품 AI 대화는 공식 Message/Bubble/Message Scroller와 Prompt Input의 InputGroup 조합으로 실제 수정안 검토·적용에 연결된다. 도입 대상·책임·의존성은 [컴포넌트 명세](08-dependencies.md)에 정의한다.

Home의 단일 `due_date`, API mutation 멱등성/충돌 처리, dialog draft, 생성 버튼 위치와 우클릭 대상은 feature에 남는다. 자체 popover/focusgroup/좌표 fallback은 제거하고 Radix에 overlay·메뉴 탐색을 맡겼다. 메뉴에서 대화상자로 전환할 때 메뉴 종료 후 열고, 취소는 원래 명령 위치로, 저장 완료는 Home 제목으로 초점을 돌린다. 저장 중에는 닫기와 중복 제출을 막고, 삭제 확인은 Alert Dialog의 취소가 초기 초점이다. 라이브러리 도입만으로 접근성 검증 완료를 주장하지 않는다.

## 현재 구현의 입력·접근성 동작

아래는 제품 Home과 별도 정적 목업의 현재 동작을 구분한다.

| 항목             | 구현 방식                                                       |
| ---------------- | --------------------------------------------------------------- |
| 대화상자         | 제품 Home: shadcn Dialog/Alert Dialog; 목업: native dialog      |
| 슬라이드 메뉴    | Popover API, 미지원 환경의 표시 fallback, 키보드 메뉴           |
| AI·Reference 탭  | ARIA tab 관계, 좌우/Home/End 이동                               |
| 패널 표시        | `hidden`, `aria-controls`, `aria-expanded` 동기화               |
| 채팅             | 라벨이 있는 textarea, role log, 선택 대상 status, IME-safe 전송 |
| 직접 텍스트 편집 | plain text와 텍스트 붙여넣기, 명시적 확정·취소                  |
| 검색 강조        | CSS Highlight API와 `mark` fallback                             |
| 문서 지연 표시   | IntersectionObserver와 이벤트 기반 fallback                     |
| 테이블           | 표 제목·헤더, 좁은 화면 스크롤 영역                             |
| 색상             | 상태 문구·아이콘 병행, forced-colors에서 시스템 색상            |
| 움직임           | reduced-motion 대응, 불필요한 장식 애니메이션 없음              |

색 대비 목표는 본문 4.5:1, 핵심 아이콘·컨트롤 경계·포커스 3:1이다. 배경을 바꾸는 경우 토큰 단독 값이 아니라 실제 렌더링 조합으로 검사한다. 채팅 입력의 포커스는 입력창을 포함하는 composer 테두리에 표시한다.

## 검증 범위

[theme-check.cjs](../mock/helpers/theme-check.cjs)는 실제 UI의 색 조합을 검사하고, [capture.cjs](../mock/helpers/capture.cjs)는 화면·반응형·포커스 관련 상태와 캡처를 수집한다. 편집기 대화와 선택 동작은 [editor-chat.cjs](../mock/helpers/editor-chat.cjs)가 담당한다.

현재 브라우저 자동화는 로컬 Chrome/Chromium 기반이다. fallback 코드의 존재는 Safari·Firefox·스크린리더에서의 검증을 의미하지 않는다. 접근성 적합성 인증, 전 기능 키보드 조작, 모바일 네이티브 입력기와 보조기기 조합은 운영 수용 검증 대상으로 남는다.

## 제품 Home

실제 Home은 shadcn Card를 semantic `<article>`로 조정하고 독립 메뉴 버튼을 둔다. 아직 없는 Studio 목적지 링크를 만들지 않는다. Dropdown Menu/Context Menu는 같은 명령을 사용하며 방향키·Esc·위치 계산은 Radix가 담당한다. Shift+F10의 진입만 Context Menu trigger로 연결하고 입력 컨트롤의 브라우저 우클릭은 보존한다. 날짜 타이머와 feature 상태는 화면 이탈 시 정리한다. 마감일은 라벨이 있는 Input과 Calendar/Popover를 제공하고 필수·달력 날짜 검증을 유지한다.

마감일은 `Temporal.PlainDate`를 우선 사용한다. 미지원 브라우저는 기존 목업과 같은 Gregorian 숫자 ordinal 계산으로 제한된 날짜 차이만 구하며 날짜 문자열을 현지 timestamp로 표시하지 않는다. 서버도 동일 범위의 달력 날짜를 검증한다. 제품의 `data/`와 개발용 캡처 저장소는 분리한다.

## 제품 Space

공식 shadcn Tabs, Progress, Dialog/AlertDialog, Input, Select, Card, Dropdown Menu, Pagination을 Folio 토큰으로 사용한다. Uppy의 실제 바이트 전송률에만 Progress 값을 부여하고 서버 파일 확인은 별도 상태 문구로 구분한다. 완료 알림은 포커스를 이동하지 않는다. Modern Web Guidance의 progress 지침을 적용하되 사용자 지침에 따라 native progress 대신 shadcn의 접근성 속성을 사용한다.

전송 대기열은 라우트 이동 동안 유지되며 새로고침하면 초기화된다. 자료 메뉴·버전 dialog의 Escape와 포커스 복귀, 320/390/768/1024/1440px 가로 넘침을 실제 브라우저에서 검사한다. 문서 썸네일은 추출 구현 전이므로 파일 형식·제목·버전 등 실제 메타데이터를 표시한다.

Space의 전체/레퍼런스/템플릿은 같은 화면의 자료 필터다. Modern Web Guidance `tabs`의 지연 조회·URL 변경 시 수동 활성화 지침에 따라 shadcn Tabs를 `activationMode="manual"`로 사용한다. 방향키는 포커스만 옮기고 Enter/Space가 조회와 URL 변경을 확정한다. Radix가 키보드·포커스·ARIA를 맡으며 별도 focusgroup/polyfill을 겹치지 않는다. 선택은 색상 외에 border 밑줄로 표시해 forced-colors에서도 남는다.

작업 진행은 body portal의 비모달 하단 패널이 맡고 간단한 알림은 하단 Sonner 토스트가 맡는다. 자동 작업 표시가 포커스를 빼앗지 않으며 Collapsible이 접기 버튼의 키보드·ARIA 상태를 관리한다. 닫은 패널은 작업 보기 버튼으로 다시 열 수 있다. 바깥 클릭은 작업 패널을 닫지 않는다.

HTML 업로드의 형식·UTF-8 제한은 파일 선택 입력의 지속적인 안내 문구로 제공하고 aria-describedby로 연결한다. Modern Web Guidance forms 지침에 따라 브라우저 accept는 선택 편의로만 사용하며 실제 파일 내용과 인코딩은 서버에서 검사한다. 기존 shadcn 입력·대화상자·업로드 알림을 재사용한다.

작업 패널은 shadcn Collapsible + Item + Progress, 토스트는 shadcn Sonner를 사용한다. 패널은 최대 360px 폭과 제한된 내부 스크롤을 가지며 바닥/오른쪽 안전 영역을 고려한다. 토스트는 ResizeObserver로 측정한 패널/런처 높이 위에 놓는다. Modern Web Guidance persistent-toast-notifications의 지속 결과 접근·비모달 표시·포커스 보호 원칙을 적용한다. shadcn 우선 정책에 따라 Sonner가 알림과 닫기·타이머를 관리하며, 진입 모션은 작업 버튼 위를 지나지 않는 fade로 제한한다.

토스트의 정보 영역은 뒤의 화면 명령 클릭을 가로채지 않고 닫기 버튼만 포인터 입력을 받는다. 진행 패널의 취소/재시도는 일반 버튼으로 유지한다. 모달이 열린 동안 발생한 새 알림은 닫힌 뒤 표시하며, 결과는 자료 목록·작업 패널에도 남는다.

제품 Admin의 사이드 메뉴는 기존 shadcn Collapsible/Button과 의미 있는 링크로 조합한다. 두 개의 로컬 목적지를 위해 별도 Sidebar 런타임이나 중복 내비게이션 트리를 추가하지 않는다. Radix Tabs를 사용하며 focusgroup·추가 키보드 핸들러·polyfill을 겹치지 않는다. 탭의 선택 상태는 밑줄, 메뉴의 현재 위치는 세로 선으로 함께 표시하고 forced-colors에서도 선을 유지한다.

## 일반 사무직 사용자 경험

주 사용자는 일반 사무직이며 화면·대화 상자·알림·접근성 이름에 내부 개발 용어나 로직을 노출하지 않는다. Folio 색상·서체와 원본 장표 색상은 유지하고, 문서·미리보기와 다음 행동을 우선한다. 버전 기록·연결 상세는 필요할 때 펼친다. 공통 언어 기준은 blueprint/07-ui-design.md가 소유한다. 원문과 사용자 입력은 정책 적용을 이유로 치환하지 않는다.

## 모바일 작업 패널

640px 이하에서 작업 패널은 화면 하단에 붙는 전체 폭 도크로 표시한다. 좌우 safe-area와 하단 홈 인디케이터 여백을 패널 안에 포함하고 내용만 제한 높이에서 스크롤한다. 접기·닫기·재열기는 같은 패널 수명과 키보드 포커스를 유지한다. 데스크톱은 기존 우측 하단 360px 패널이다.

Feedback이 측정된 도크 높이를 문서 하단 padding과 scroll-padding에 반영하여 마지막 본문 버튼이 패널 위까지 스크롤되도록 한다. 패널이 사라지면 예약 여백도 해제한다. Toast는 데스크톱의 외부 간격과 모바일의 하단 밀착 위치를 구분하여 도크 위에 배치한다. 목업도 같은 모바일 규칙과 측정/해제 수명을 따른다. 모바일 고정 패널 캡처는 전체 문서가 아니라 실제 viewport 단위로 기록한다.

## Space 통합 검색 화면

상단 공통 검색은 Space 레퍼런스·템플릿만 대상으로 한다. `/home/space`에서 하나의 큰 검색 입력과 전체/레퍼런스/템플릿 탭, 파일 정보·본문 조건, 자료 상태와 페이지네이션을 제공한다. 추가 검색 조건은 접어 두고 필요할 때 펼치며, 조건이 적용된 URL로 진입하면 해당 설정을 표시한다. 검색 전·로딩·빈 결과·오류·재시도를 구분한다. 입력 중에는 요청하지 않고 명시적으로 제출하며 한글 조합 중 Enter로 제출하지 않는다.

결과는 왼쪽 원본 썸네일, 오른쪽 제목·출처·일치 본문·파일명·날짜의 뉴스형 행이다. 실제 일치 텍스트만 강조하며 native Highlight API와 안전한 mark fallback을 공유한다. 원문 HTML은 실행하지 않는다. 원본 썸네일은 lazy load하고 원래 색상을 유지한다.

결과는 `/home/space/documents/:kind/:id`의 정상 페이지로 이동하며 모달이나 추가 본문 검색 입력을 열지 않는다. 명시적인 검색 결과 복귀 링크가 조건과 페이지를 유지하고, 상세 로딩 후 문서 제목으로 키보드 초점을 옮긴다. 기존 자료 관리의 빠른 미리보기는 동일한 내용 컴포넌트를 사용한다. 검색과 상세 페이지에서는 Space 내비게이션을 현재 위치로 표시한다.

## Studio 목차·내용 화면

세 번째 단계는 mock의 수평 목차 선택을 한 곳에 두고, 왼쪽의 사용할 내용과 오른쪽의 원문 근거를 나란히 배치한다. 전체 목차 입력 폼을 본문에 상시 노출하지 않는다. 목차 편집·제목 수정은 shadcn Dialog에서 수행하며 변경은 닫은 뒤에도 초안으로 유지한다. 내용 담기는 별도 Dialog에서 원문을 검색·선택하고, 원문 후보는 이때만 조회한다. 연결 내용을 선택하면 오른쪽에 전체 본문·이미지·출처를 표시하며 원문 보기는 해당 파일 버전/페이지로 연다. AI 선택·자동 연결은 shadcn Collapsible에 모으고 기존 목차가 있으면 기본으로 접는다. 작업 진행·오류·재시도는 접힘 여부와 무관하게 표시한다. 모바일은 두 영역을 위아래로 배치한다. 프로젝트 선택기에서 현재 프로젝트를 표시한다. 관련 자료 검색은 근거 단계의 추가 검색에서 제공한다. 작업 패널이 있는 데스크톱에서도 측정된 패널 높이만큼 문서 끝 여유를 확보해 최종 저장 버튼까지 스크롤할 수 있다. 제목·설명은 일반 사무직 표현을 사용하고 모델 ID·Provider 설정·체크포인트를 표시하지 않는다. 같은 원문을 여러 목차에 연결할 수 있으며 파일·페이지·원본 버전을 확인할 수 있다.

순서 변경은 실제 DOM 순서와 일치하는 stable key 전환이며 한 번의 상태 안내를 제공한다. 이동 버튼의 경계 상태는 aria-disabled로 알리고 클릭을 무시해 이동 직후 키보드 초점을 유지한다. 상위 목차와 하위 목차를 함께 이동하며 세 번째 계층은 만들지 않는다. 저장하지 않은 가이드로 다음 단계에 진행하지 않는다. 목차 세션은 이전 Studio 단계로 이동해도 유지하고 원본/가이드 변경 시 연결을 명시적으로 다시 검토한다.

원문 표는 공식 shadcn Table source를 사용한다. 이름 있는 스크롤 영역과 caption, 제공된 헤더/병합 셀 semantics를 유지하며 원본 병합 관계를 훼손하는 모바일 카드 전환은 적용하지 않는다. 정보가 부족한 표는 안전한 텍스트로 표시한다. 네이티브 스크롤 영역에 대한 좁은 lint 예외는 키보드 접근 목적을 코드에 명시한다.

Modern Web Guidance `content-first-noise-reduction`의 보조 도구 지연 노출 원칙을 적용한다. 전역 내비게이션은 기존 계약대로 고정하며 자동으로 숨기지 않는다. Dialog와 Collapsible는 기존 Radix 기반 shadcn 소스를 재사용하고 닫기/Escape 후 호출 버튼으로 초점을 돌린다. 목차 선택은 단일 Tabs이며 방향키·Enter/Space는 Radix가 소유한다.

## 추가 탐색 상태와 원문 문맥

관계 검색은 후보 수가 늘어나므로 전체 백분율을 표시하지 않는다. Modern Web Guidance progress의 “Announce completion without stealing focus”에 따라 polite status에서 비교·문맥 확인·추가 탐색·완료를 알린다. 기존 단일 평가 실행의 확정된 분모에만 shadcn Progress를 유지한다.

Studio에서는 후보 제목을 선택할 때 검토 영역의 원문을 조회한다. Space 검색은 뉴스형 결과를 유지하고 Studio는 후보 목록과 원문/비교 자료를 나란히 제공한다. 후보 문맥 버전을 Query 키에 포함하고 상시 폴링하지 않는다. 정확한 버전·페이지의 미리보기를 닫으면 호출 버튼으로 초점을 돌린다. 부분 결과에는 한도와 확인이 필요한 자료를 표시하고 해시·프롬프트·실행 코드를 노출하지 않는다.

## Space 탐색과 Studio 근거의 역할

Space의 홈은 검색이다. `/home/space`에서 공용 자료를 찾고 뉴스형 결과를 읽으며 `/home/space/documents/:kind/:id`의 문서 상세로 이동한다. 검색 조건과 결과 복귀를 유지하고 업로드·버전·보관은 `/home/space/library`의 자료 관리에서 수행한다. 기존 `/home/search`, `/home/documents/...`와 구형 Space 자산 탭 링크는 새 내부 경로로 연결한다.

Studio 근거는 검색 포털이 아닌 자료 선택 작업 영역이다. 선택한 근거를 기본으로 표시하고 추가 검색 탭에서 후보를 수집한다. 후보 목록은 짧은 발췌와 선택 상태를 보여주며 제목을 선택하면 옆 검토 영역의 원문/비교 자료 탭에서 읽는다. 원문을 모든 결과 행 아래에 펼치지 않는다.

900px 초과에서는 실제 상단 내비게이션 높이와 작업 패널 여백을 뺀 동적 화면 높이에 두 검토 패널을 맞춘다. 목록과 원문은 각각 키보드로 스크롤할 수 있는 이름 있는 영역이며, 영역 끝에서 페이지로 스크롤이 전달되지 않도록 한다. 제목 선택 시 검토 영역을 내비게이션 아래로 이동한다. 900px 이하에서는 목록과 원문 상세 중 하나만 표시하고 내부 스크롤 없이 문서 전체가 스크롤된다. 상세에서는 검색 입력과 결과 탭을 감추며 ‘목록으로’로 이전 목록 위치와 제목 초점을 복원한다. 검색 초안, 결과와 선택 상태는 전환 중 유지한다. 이는 화면 전환이며 별도 모달이나 새 검색 실행이 아니다.

Modern Web Guidance tabs의 “Use selection by activation instead when showing a panel has a cost”에 따라 URL 변경·조회가 있는 작업 탭은 수동 활성화한다. Radix가 키보드와 ARIA를 소유하며 선택은 테두리 밑줄로도 표시한다. 검색 입력은 탭 전환 시 보존하고 단계 방문·검색 완료·자료 선택만으로 근거 확정을 표시하지 않는다.

## 실제 발표자료 생성 UI

공식 shadcn Button/Input/Select/Collapsible을 사용해 템플릿 미리보기와 선택을 구분하고 명시적 제출로 생성한다. 근거 fingerprint 또는 디자인 version 충돌 시 입력을 유지하고 최신 상태를 조회한다. 슬라이드는 실제 출력 PNG와 생성 중 내용 초안을 구분하며, 텍스트/발표 메모/출처 disclosure를 제공해 이미지로만 읽기를 제한하지 않는다. Desktop은 좌측 세로 썸네일·중앙 장표·우측 내용/참고 자료 패널, 모바일은 가로 썸네일·장표·아래 정보 패널의 읽기 순서를 유지한다. 범용 웹 편집기를 구현한 것처럼 보이는 가짜 조작점은 없다.

Studio Stepper는 모든 단계에서 전역 메뉴 아래에 고정한다. 실제 헤더/Stepper 높이를 측정하고 화면 이탈 시 관찰자를 정리한다. 모바일은 여섯 마커와 짧은 단계 이름을 한 줄에 모두 표시하며 접근성 이름은 원래 단계명을 유지한다. 근거 읽기와 장표 영역은 이 높이만큼 스크롤 여백을 확보한다.

생성 범위·제목·추가 요청은 본문에 통합하며 별도의 설정 버튼이나 접기 영역을 제공하지 않는다. 생성 모델 선택은 서버가 담당한다. 기존 결과는 편집 영역을 먼저 보여주고 그 아래에 추가 생성 폼을 배치한다. AI/직접 작성 탭 전환은 입력 초안을 유지한다. 장표 작업 영역은 목업의 3단 구성을 따른다. 좌우 패널은 공식 shadcn Collapsible로 독립 제어하고, Trigger는 숨겨지는 패널 밖에 둔다. 선택한 슬라이드·우측 탭을 유지하며 닫힌 패널은 키보드 탐색에서 제외한다. 원문 조회는 해당 슬라이드의 참고 자료 탭이 활성 상태일 때 수행한다. AI와 대화 탭은 텍스트·객체·배치와 여러 장표 수정안을 검토·적용한다. 객체 탭은 로컬 이미지 등록, 실제 차트 수치 입력, 객체 선택을 맡는다. 선택 버튼의 aria-pressed와 장표 수·객체 수를 함께 표시하고 Ctrl/⌘ 없이도 여러 장표를 고를 수 있다. 캔버스 드래그 핸들은 아직 제공하지 않는다.

## 장표 객체와 일괄 수정

이미지 정규화는 기존 Sharp 0.35.5, 이미지·도형·텍스트·네이티브 차트 출력은 기존 python-pptx 1.0.2와 전이 Pillow를 재사용한다. [공식 차트 API](https://python-pptx.readthedocs.io/en/latest/user/charts.html)의 CategoryChartData/add_chart로 데이터 workbook을 포함하고 [그림·도형 API](https://python-pptx.readthedocs.io/en/latest/api/shapes.html)를 사용한다. 별도 캔버스/차트 런타임이나 외부 편집 SaaS를 추가하지 않는다. Sharp의 실제 디코더로 PNG/JPEG/WebP·화소 수·페이지 수를 검사하고 메타데이터를 제거한 PNG를 만든다. React는 기존 Query/Zustand/shadcn으로 범위 선택·이미지 등록·데이터 검토를 구성한다.

## V21 객체·이미지·일괄 수정 계약

SlideSpec v2는 선택적 objects와 layout을 추가한다. v1 원본 Blob은 그대로 읽으며 명시적 객체 수정 때만 v2 파생 Spec을 만든다. 객체는 안정적인 ID·이름·백분율 frame(x/y/width/height/rotation)과 image/chart/shape/text content다. 최대 20개 객체, 좌표 틀은 0~100%, 회전은 ±180도, 텍스트는 1,000자/8~72pt, 전체 Spec은 64 KiB 이하로 검증한다. chart는 column/bar/line/pie, 최대 20개 고유 항목·4개 고유 이름의 계열, 동일 배열 길이와 유한 수치(절댓값 10¹² 이하)를 요구한다. pie는 양의 합을 가진 단일 비음수 계열이다. 수치의 업무상 정확성은 사용자 검토 대상이다.

- `GET/POST /api/v1/projects/{p}/presentation-media`: 등록 목록/바이너리 이미지 업로드. POST는 name 질의와 Idempotency-Key, 최대 5 MiB를 받는다. 실제 디코딩은 PNG/JPEG/WebP 단일 이미지·1,600만 화소까지이며 PNG 결과는 8 MiB 이하다. 프로젝트당 100개 등록, 동시 정규화 2개를 제한한다. 같은 키의 다른 이름/원본은 409다.
- `GET /api/v1/projects/{p}/presentation-media/{id}`: 해당 프로젝트에 등록된 수동 PNG만 반환한다. 원본 바이트와 정규화 바이트는 각각 CAS에 저장한다. 등록에는 원본/PNG Blob FK와 크기만 기록하고 모델은 URL이나 경로를 지정할 수 없다.
- 기존 edit POST에 slide_ids(최대 24개, 기준 장표 포함), object_ids(단일 장표에서 최대 20개)를 추가한다. fields는 title/bullets/notes/objects/layout이다. object_ids가 있으면 objects만 수정하고 목록에 없는 객체·새 ID는 거부한다. 빈 object_ids는 대상 장표의 전체 객체 목록을 수정할 수 있다.
- `presentation_edit_targets`는 고정 source slide version, 위치, 객체 선택, 완료한 제안 Blob/요약/모델 요청을 소유한다. V20 요청은 단일 target으로 backfill한다. `presentation_edit_media`는 접수 시 사용 가능한 이미지 목록을 고정한다. `presentation_edit_target_media`와 `presentation_slide_media`는 제안/확정 장표의 이미지 참조를 추적한다.
- 작업은 대상 장표별 한 번씩 순차 추론하며 완성한 수정안을 lease 검사 후 checkpoint한다. 실패·취소 후 재시도는 미완료 대상만 처리한다. 완료 count는 응답 targets에 있고 slides는 각 장표의 before/proposal이다. 기존 scalar before/proposal도 기준 장표용으로 유지한다.
- 적용은 모든 target이 완료됐고 base deck이 최신일 때만 허용한다. 대상 장표만 새 version으로 만들고 미대상은 재사용하며 누락·변경한 장표만 렌더링·검사하고 통과한 장표를 네이티브 PPTX로 조립한 뒤 한 번 head를 전진시킨다. 명시적인 새 수정은 지원 가능한 과거 Spec을 현재 렌더러로 처리할 수 있지만 이미 실행 중인 작업의 runtime pin은 그대로 검사한다.

## V22 중앙 비교와 세션 되돌리기

새 수정안은 모델 결과를 장표별로 저장한 뒤 실제 PPTX·PNG를 렌더링하고 검증해야 ready가 된다. `presentation_edit_renders`는 검증된 PPTX Blob, `presentation_edit_previews`는 기준 slide ID별 PNG를 참조한다. 승인 후 생성 작업은 이 결과를 재사용한다. 기존 미리보기 없는 수정안은 이전 렌더링 경로로 적용한다.

`presentation_editor_sessions`는 프로젝트·발표자료·현재 기준 리비전·만료 시각만 보관하는 캐시 소유자다. 인증·계정·사용자 권한 기능이 아니다. `presentation_undo_stack`은 세션당 최대 3개의 이전 확정 리비전 참조를, `presentation_run_sessions`는 승인된 작업과 캐시 세션의 임시 관계를 보관한다. 세션 삭제는 두 캐시 테이블로 cascade하며 확정 산출물은 지우지 않는다. 종료된 세션에 속한 작업이 나중에 완료돼도 캐시를 다시 만들지 않는다.

- `POST /api/v1/projects/{p}/presentations/{run}/editor-sessions`: 메모리에서 생성한 session_id로 편집 방문을 연다. 새 방문은 빈 되돌리기 목록에서 시작한다.
- `PATCH /api/v1/projects/{p}/editor-sessions/{id}`: 활성 방문의 만료를 갱신한다. 클라이언트는 60초마다 갱신하며 30분 비활성 세션은 만료된다. 서버는 60초 간격과 관련 명령에서 만료 캐시를 삭제한다.
- `POST /api/v1/projects/{p}/editor-sessions/{id}/close`: 화면 이탈·프로젝트/발표자료 변경·pagehide의 닫기 신호를 처리한다. 반복 닫기는 안전하며 시작·종료 시에도 모든 캐시를 정리한다.
- edit apply 본문의 선택적 editor_session_id는 결과를 해당 세션의 되돌리기 목록에 연결한다. 기존 클라이언트의 생략된 값은 캐시를 만들지 않는다.
- `GET /api/v1/projects/{p}/presentations/{run}/history?session_id=...`: 직전 확정 run, 논리적 장표별 이전 slide ID, 해당 세션의 undo_remaining을 반환한다. 다른 방문자의 변경으로 기준이 달라졌다면 되돌리기는 0이다.
- `POST /api/v1/projects/{p}/presentations/{run}/undo`: expected_version·editor_session_id·Idempotency-Key로 최신 상태를 검사한 뒤 이전 상태를 새 확정 리비전으로 복원한다. PPTX·Spec·미리보기 바이트를 다시 만들지 않고 모델도 호출하지 않는다. 한도 소진·만료는 422, 오래된 상태는 409다.
- `GET /api/v1/projects/{p}/slide-edits/{edit}/slides/{source_slide}/preview`: 해당 프로젝트 수정안의 실제 PNG를 제공한다.

비교는 읽기 전용이다. 편집 세션이 끝나도 확정 버전 간 비교는 기존 리비전으로 가능하지만 되돌리기 캐시는 복원하지 않는다. `presentation_restorations`는 확정 복원 결과의 출처와 멱등 명령을 기록하며 캐시 테이블과 구분한다.

## 편집 모델 자동 선택과 수정 대상

편집 UI는 connection_id와 model_version을 보내지 않는다. 기존 API 클라이언트는 두 값을 함께 보낼 수 있으나 한쪽만 지정하면 거부한다. 생략하면 서버가 기준 run의 설정에서 연결을 찾고 현재 활성 LLM 설정을 접수 시 고정한다. 비활성·Decision 연결은 다른 모델로 대체하지 않고 설정 확인을 안내하는 422를 반환한다. 멱등 재요청은 처음 접수한 요청과 설정을 유지한다.

객체를 선택하면 objects와 해당 object_ids만 보낸다. 선택이 없으면 현재 장표 또는 명시적인 slide_ids 묶음의 title·bullets·notes·objects·layout 전체를 수정 가능한 범위로 보낸다. 모델은 요청하지 않은 필드에 null을 반환해 원래 값을 보존한다. null은 객체 삭제나 배치 초기화를 뜻하지 않는다. 브라우저 draft에는 요청문만 보관한다.

## V23 workflow execution checkpoints

workflow_executions stores definition key/version/signature; workflow_nodes stores node version, order, state, attempt, lease and timestamps. presentation_workflows links each canonical presentation job to one execution. workflow_events stores committed transitions with increasing IDs. workflow_artifacts references the render output and ordered preview Blobs through foreign keys. Job status, input revisions, model settings, runtime version and command receipts remain in presentation_runs.

Migration backfills completed runs as completed nodes and recognizes existing slide checkpoints without regenerating their bytes. New admission commits the job and graph together. Unsupported definitions, node versions or signatures fail with workflow_incompatible before invoking a handler. Existing endpoint paths and optimistic versions remain intact; run responses add steps(key/state/attempt).

The existing 30-second job lease and 2-second heartbeat fence commits. Interrupted execution automatically requeues for at most three attempts; explicit retry rechecks the existing base/input constraints. Restart resets running nodes to pending and preserves completed nodes and render output. Taking over a job invalidates the old node lease. Render checkpoint and node completion share a transaction; publication and final-node completion share another. No LLM or process call holds a write transaction. Event replay/SSE endpoints are not yet exposed.

## V24 document preparation checkpoints

`document_workflows` links canonical `document_jobs` to generic executions named `document:{job_id}`. Document v1 is extract → classify → ready; template v1 is extract → ready. An insertion trigger registers the graph in the same transaction as each new job, including uploads discovered at startup. Migration backfills existing extraction, classification and completed-template checkpoints without rewriting original bytes, blocks or previews.

Job/detail/history responses add `steps: [{key, state, attempt}]`; existing processing routes, expected versions and idempotency receipts remain intact. Document jobs retain status, immutable source/profile pins, model configuration and completed block decisions. Generic nodes retain execution state only. Each write validates visibility, the current 60-second lease and supported graph version/signature; heartbeat runs every two seconds. Failed or cancelled late results cannot advance a job.

Extraction association, canonical blocks, their FTS index and extract-node completion commit together. Template results have their existing atomic commit and are reused if interruption occurs before the node checkpoint. Final readiness verifies required extraction/template results and completed decisions, then commits ready-node completion and job success together. Search can read indexed text before classification finishes; readiness is not a second indexing pass. Classification progress is measured from completed/total blocks, not an estimate of total preparation time.

Missing model configuration releases the lease and leaves classification pending. Cancellation/retry and restart preserve completed extraction and decision batches; automatic interruption retries stop at three attempts. In-flight model calls without a committed batch may repeat. No exactly-once external call or independent per-page OCR recovery is claimed. Unsupported definitions fail before tool/model execution. Presentation recovery is scoped to presentation associations and cannot reset document nodes.

## V25 outline generation and mapping checkpoints

`outline_workflows` links canonical `outline_runs` to `outline:{run_id}` generic executions. Generation uses outline v1 compose → publish; mapping uses mapping v1 map → publish. Admission registers the graph in the same transaction through an insertion trigger. Existing completed batch responses are recognized during migration; original block IDs, request IDs, revisions, confirmations, source reviews, guide and model pins are unchanged.

Run/state/command responses add `steps: [{key, state, attempt}]`. Existing endpoints, expected versions and idempotency receipts remain intact. The feature owns run status and batch responses; generic tables own definition identity and node transitions. Every node begins under the supported definition and current 30-second canonical lease; the engine supervises heartbeat every two seconds and owns cancellation/join. Outline execution has one slot independent of document/template and PPT pools. Model connection queues remain a separate shared owner.

Each successful batch retains its existing validated alias response and request ID. Saving the final batch completes the compose/map node in the same transaction. Publication rebuilds the draft from canonical batch output and source IDs, validates pinned inputs and current base version, then advances the revision/head, completes publish and marks the run succeeded in one transaction. Publication failure rolls back the revision; explicit retry reuses the completed model stage. No original text is duplicated into node checkpoints.

Cancellation, project lifecycle cancellation, lease expiry and startup recovery update associated running node states in the canonical status transaction. Automatic interrupted attempts stop at three; explicit retry still requires valid original inputs and no other active project run. Late output with a cancelled/replaced/expired lease cannot write a batch or head. Completed batches survive retry/restart. Uncommitted in-flight model calls may repeat; exactly-once external execution is not claimed. Unsupported graph/node versions fail before inference. Relation and chat-proposal workflows also use the common engine; SSE/unified monitoring are not exposed by this migration.

## V26 relation execution checkpoints

`relation_workflows` links canonical relation_runs to `relation:{id}`. The graph is retrieve → review → publish. Candidate retrieval and its successful checkpoint share admission's transaction; an empty search can complete there without calling a model. Review retains existing v1/v2 bounded exploration, up to four parallel model groups, pinned Decision/planner settings, assessment cache and source context. Budget termination preserves partial results and a visible stop reason. Review checkpoint and budget closure share a transaction; final status and publish completion share another. Final-publication retry does not repeat review. Cancellation/project deletion/lease expiry/startup recovery update associated running nodes through canonical-status triggers. Automatic interrupted execution is bounded to three attempts. Responses add steps(key/state/attempt); no workflow SSE endpoint is introduced.

## V27 pinned native reference insertion

Generate optionally accepts materials: [{job_id, material_id}], up to ten choices. Empty selections are omitted from command fingerprints for compatibility. `presentation_generation_imports` pins registered source IDs at admission. After normal drafts complete, objects enrich the first slide and whole source slides append to the deck; `presentation_reference_drafts` retains the original model Spec Blob and records once-only enrichment. This is pre-publication generation work, not a change to a confirmed revision.

POST `/api/v1/projects/{p}/presentations/{run}/materials` accepts expected_version, slide_id, optional editor session and items: [{job_id,material_id}]. The target must be the current completed deck. The command retains its idempotency key/fingerprint, registers immutable imports and queues a render-only new revision. Objects modify the selected slide; source slides append immediately after it. At most 24 slides and 20 objects per slide apply. Project reference registrations are bounded to 500. With an editor session, the existing disposable three-step undo policy applies; no account layer is added.

`presentation_material_imports` references the canonical job/material; `presentation_slide_imports` records exact usage. `presentation_edit_imports` freezes allowed references and `presentation_edit_target_imports` records proposal usage. Originals stay in content-addressed storage, source text stays in content_blocks, and native package parts/workbooks remain editable in the output. SlideSpec v3 adds the typed reference object with a registered reference_id; v1/v2 remain readable. slide_key gives imported slides independent durable identity and preserves chat/comparison isolation when they share an outline section.

GET `/api/v1/projects/{p}/presentations/{run}/slides/{slide}/materials` returns pinned source metadata, exact job/page/version and availability for the Reference inspector. Logical deletion blocks new selection and source preview while existing confirmed output and pinned Blob references remain preserved. Runtime stages each distinct native source once, caps aggregate native bytes at 150 MiB and fits source geometry into destination bounds. PDF pages remain raster references; external source URLs are never fetched.

## V28 conversational execution checkpoints

`slide_edit_workflows` links canonical presentation_edits to `edit:{id}`. The graph is propose → render. Per-target validated proposals and final propose-node success commit together; native PPTX/preview registration, render-node success and ready status commit together. A render-only retry reuses proposals and their model requests. Late/cancelled leases cannot commit and automatic interruption retries stop at three attempts. Generic definition/node identity is checked before handlers.

Ready means a reviewable proposal, not an accepted deck. Apply remains explicit, checks the current head/session and reuses validated preview output through normal presentation publication. A bounded server-side source search can supply eight matching current shared material choices. Each target prompt includes its existing references plus at most twelve additional registered choices. The model may only propose allowlisted IDs/fields; normal source text cannot expand tool authority. Full provider-native multi-tool loops, generic Human Gate nodes, parallel DAG nodes and event-stream monitoring remain outside the implemented scope.

## V29 per-slide quality and render cache

`presentation_render_cache` has the composite key (project_id, cache_key), output/preview Blob FKs, report_json and last_used_at. It stores validated one-slide native PPTX and PNG outputs. A key hashes runtime profile, full Spec, destination position, template version and actually used image/reference identities and content hashes. Repair permission is not part of the key: a previously validated identical slide is reusable without changing it. Cached bytes are size/hash verified before use. Missing or damaged derived cache bytes are treated as a miss; source/confirmed output integrity is never reset.

`presentation_quality_checks` records workflow_id, project_id, style_key, slide_version_id, one-based position, passed, report_json and reused, uniquely per workflow/slide. Workflow and slide identities use canonical FKs; generation uses its run ID and conversation uses edit:{id}. A successful outcome, output metadata and cache entry commit in one transaction after checking project visibility, current edit base, membership, canonical job lease and the running render-node lease. Failed outcomes retain no successful render cache entry. Retries replace the check snapshot; confirmed revisions remain immutable.

Run and Edit responses add quality: [{position, reused, report}]. Report schema_version=1 contains passed, repair_attempts (0–2), issues: [{code, severity}] and optional typography: {title, body} in SVG-pixel units. Reports contain fixed codes, not source text/tool stderr. Ordinary UI maps them to office language and never shows cache/provider identifiers. Old completed work returns an empty list and is not automatically rerendered by migration.

The first generation (base_version=0, not a restoration) permits two deterministic font reductions, down to 22px title and 14px body. Text is never truncated. Later generation/editing uses its requested content without additional automatic fitting; already checked identical text/layout may retain its prior typography recipe. Object text and imported artwork are not silently reformatted. Layout estimates, missing source links, native text/chart values, raster aspect ratio and managed bounds are checked. Potential artwork overlap is a warning; blocking errors produce slide_quality_failed and preserve successful drafts/renders.

The derived cache is capped at 512 entries and 512 MiB per project, evicted by last use. This bounds live cache references, not immediate physical disk reclamation: backup references and the existing orphan grace period continue to protect Blob bytes. Durable style and quality records remain outside that cache. Every passed slide contributes one saved preview and native part; final assembly copies native part graphs and validates text/chart/workbook preservation. No LLM calls or rasterization of unchanged slides occur during assembly. Approved proposals map their saved quality/style records onto the newly published slide IDs without rendering again. Publication retains existing input/CAS, cancellation, idempotency and explicit approval rules.

## V30 manual canvas authoring

`presentation_manual_designs` pins a project and optional immutable template job. presentation_runs permits nullable design_id/config_id and adds manual_design_id; exactly one design owner is required. No fake provider, outline or evidence rows are created for blank decks. presentation_edits permits a null outline node while retaining a real source slide, revision and model pin. The backed-up migration rebuilds these parent tables, copies IDs/records, restores existing triggers/indexes and checks every FK.

POST `/api/v1/projects/{p}/presentations/blank` accepts title, template_job_id|null and layout_key. GET `/api/v1/projects/{p}/presentation-layouts` accepts either template_job_id or run_id, returning bounded native layout choices, names, slot frames/capacities and example pages. Fresh choices require an active prepared template; existing deck operations retain their pinned template bytes.

POST `/api/v1/projects/{p}/presentations/{run}/canvas` accepts expected_version, slide_id, session|null and a typed operation. Operations are geometry(placements), insert(object), text(object_id/text), add_slide(layout_key), duplicate_slide, delete_slide and move_slide(position). Frames remain percentage coordinates within the slide. Direct reference IDs are not accepted by insert: reuse the existing version-pinned material insertion API. Image IDs must belong to this project. All writes require Idempotency-Key, canonical project/current head and optional live editor-session checks; every fork queues ordinary rendering/publication and reuses untouched slide versions.

`presentation_canvas_commands` records the base revision and operation for render-only manual forks. Receipts retain a bounded hash of command content, not copied source text. Input hashes and source/Spec IDs remain canonical. Cancel/retry, conditional publication, immutable outputs and disposable three-entry undo continue through the existing engine.

SlideSpec v4 design={layout_key, authored} identifies the selected native layout. Authored manual slides may have empty title/body/evidence. Model-authored template slides must have real block IDs and authored=false. The model receives up to twelve eligible layouts within a 10 KiB context budget, chooses a permitted layout and returns slot_id/content choices. Rust hydrates actual object frames from the pinned layout and checks role, text capacity and all selected reference IDs. Source-defined geometry is not accepted from model output. Native rendering preserves template masters/styles and puts extra text into actual placeholders.

The provider response schema nests additional objects inside its chosen design variant. Each variant exposes only that layout's additional slots and compatible content kinds; primary title/body slots are reserved for the root title/bullets fields. A layout without additional slots requires an empty array. The adapter converts this response into the existing flat SlideSpec v4 objects array before persistence, so saved revisions keep their existing schema. Server validation remains authoritative when a provider ignores the supplied schema.

## V31 passive canvas artwork layers

presentation_quality_checks adds cache_key. `presentation_render_layers` stores the project/render key, namespaced object key, PNG Blob FK and derived frame. Rows cascade only with derived cache eviction. The background key cannot collide with an authored object's ID. Quality checkpoints and approved proposal/undo mapping retain the exact key; confirmed PPTX and full previews stay independent.

GET `/api/v1/projects/{p}/presentations/{run}/slides/{slide}/layers` returns available layer IDs/frames. GET the same path plus `/{layer}` streams a passive PNG after project/run/slide and successful-check membership validation. No arbitrary paths, SVG, model URLs or provider secrets are returned. Missing legacy/evicted layers return an empty catalog and retain the full preview fallback.

Native shape metadata binds top-level actual shapes to their specs. lxml isolates generated SVG copies and bundled Sharp rasterizes at most 21 PNGs, 4 MiB each and 64 MiB total, without source execution in the browser. Existing per-project 512-entry/512-MiB live cache budgeting includes layers. Logical eviction does not bypass reference/backup protection or the Blob grace period.

## V32 per-model generation budget

`llm_provider_config_versions.max_output_tokens` is nullable, with integer bounds 256–65,536. Existing configuration rows keep null and retain caller-owned task defaults. Admin provider GET/PUT exposes the optional value; a save creates a new immutable configuration and retains optimistic version checks. The model server's loaded context is a separate concern and is never changed by ordinary application requests.

The same migration preserves all existing timeout values and expands their validated range to 5–900 seconds. The default remains 180 seconds; opt-in local-model acceptance uses 600 seconds. HTTP transport and the shared execution deadline use the pinned value, while cancellation and queue admission remain separately bounded.

Structured authoring resolves the override from its pinned configuration before provider serialization. This covers outline, presentation and chat authoring; changing the connection cannot change an already pinned job. Diagnostics and typed Decision execution keep their own budgets. Invalid values or a budget on a Decision-only connection are rejected. Saving a budget does not regenerate existing results.

## Selected outline generation

GET `/api/v1/projects/{p}/presentation-preparation/sections?design_id={id}` returns the current reviewed design's `outline_revision_id` and ordered `sections` (`id`, `parent_id`, `title`). An outdated design returns a conflict. This is a read-only canonical projection and never triggers analysis or generation.

POST `/api/v1/projects/{p}/presentations` accepts optional `node_ids`. Omission/null preserves legacy all-section generation and its serialized command fingerprint. An explicit empty array or duplicate/unknown IDs is rejected. Branches expand to unique leaf nodes in outline order, including when a branch and its child are both requested. The server normalizes request IDs for idempotency and validates them against the project's pinned outline revision before admitting work.

No migration or duplicate outline storage is required: the reviewed design pins its outline revision, immutable command receipts identify the requested scope, and `presentation_slide_versions.node_id` records the resolved scope. Only those nodes receive writing calls; explicitly chosen whole source slides/pages may still be appended. Existing optimistic head commits, cancellation, retries and checkpoints apply. A newly scoped revision contains that chosen scope, not an automatic merge with unchecked slides from the previous revision; earlier files remain available.

## 생성 모델 자동 선택

PPT 생성 UI는 `connection_id`와 `model_version`을 보내지 않는다. `POST /api/v1/projects/{p}/presentations`는 두 필드의 동시 생략/null을 허용하며 명시적으로 제공하는 기존 클라이언트는 두 값을 함께 보내야 한다. 기존 명시적 요청의 직렬화 fingerprint는 유지한다. 신규 생성은 활성 LLM 연결을 최초 등록 시각·연결 ID 순으로 선택한다. 설정 수정으로 기본 순서가 달라지지 않으며 Decision 연결은 제외한다. 기존 발표자료의 새 버전은 현재 head의 연결을 우선하며, 비활성/사용 불가 상태면 다른 연결로 대체하지 않고 422를 반환한다. 수동 빈 장표처럼 연결이 없는 자료는 신규 기본 선택 규칙을 사용한다.

선택은 생성 접수의 짧은 SQLite 트랜잭션에서 이루어지고 기존 `presentation_runs.config_id`에 불변 설정 버전을 고정한다. 설정 변경은 접수한 작업이나 멱등 재요청을 재지정하지 않는다. 연결이 없거나 유효하지 않으면 관리자 확인이 필요하다는 일반 문구를 반환하며 작업이나 빈 발표자료를 남기지 않는다. 이 계약은 기존 Admin 연결 설정을 사용하며 별도의 작업별 라우팅 테이블·UI 구현을 뜻하지 않는다.

## 생성 모델 자동 선택 검증

`presentation_models.rs`는 실제 HTTP·SQLite·렌더러에서 자동 선택 순서, 설정 수정 후 우선순위 유지, Decision 제외, 접수 후 비활성화되어도 고정 설정으로 완료되는 동작, 기존 발표자료 연결 유지, 연결 없음·불완전한 모델 필드·오래된 버전 거부, 명시적 구 API 요청과 재시작 뒤 멱등 재요청을 검증한다. React는 모델 입력란 없이 범위만 전송하고 연결 불가 안내 후 입력·범위와 재시도를 유지하는지 검사한다. 실제 브라우저의 생성·레퍼런스 삽입·새 버전 작성 흐름은 AI 선택 없이 실행하며 모델은 로컬 합성 fixture다.

## 생성 목차의 행 작업 검증

GenerationScope 검사는 연필·＋가 체크박스 선택을 바꾸지 않는지, 중목차 아래에는 추가 버튼이 없는지를 다룬다. 실제 브라우저는 제목 변경, 중목차 추가·이동, 저장 후 새 준비 상태와 기존 PPT 보존, 독립 브라우저 조회·재시작을 검증한다. `presentation_scope.rs`는 목차·디자인 갱신과 동일 요청 복구, 오래된 초안 거부를 검사한다. 새 중목차는 해당 가지의 원문 ID를 초기 문맥으로 재사용한다. 별도 자동 의미 매핑을 실행했다는 뜻은 아니다.

업로드에서 목차까지 자동 진행하는 3단계 Studio 전환, 생성 중 자동 근거·디자인·그림 탐색 및 기존 장표의 맥락별 자동 재작성은 아직 전체 연결이 완료되지 않은 후속 구현 범위다. 현재 목차 행 작업 및 생성 모델 자동 선택의 검증과 구분한다.

일반 생성 폼은 레퍼런스 선택 버튼과 materials 초안을 갖지 않는다. `generation-form.test.tsx`와 실제 브라우저 범위 생성 검사는 버튼·추가 자료 payload 부재를 확인한다. `reference-generation-edit.cjs`는 기존 명시적 자료 생성 API를 사용해 fixture 결과를 만든 뒤, 실제 편집기에서 자료 추가·대화 편집·리비전 보존을 검증한다. 이 검사는 자동 자료 탐색·맥락 재작성의 완료 근거가 아니다.
