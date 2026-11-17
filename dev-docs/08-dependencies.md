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

생성 설정은 최초 작성 시 펼쳐져 있고 결과가 생기면 접히며, 사용자가 다시 펼칠 수 있다. 접어도 제목·모델·추가 요청은 유지한다. 장표 작업 영역은 목업의 3단 구성을 따른다. 좌우 패널은 공식 shadcn Collapsible로 독립 제어하고, Trigger는 숨겨지는 패널 밖에 둔다. 선택한 슬라이드·우측 탭을 유지하며 닫힌 패널은 키보드 탐색에서 제외한다. 원문 조회는 해당 슬라이드의 참고 자료 탭이 활성 상태일 때 수행한다. AI와 대화 탭은 텍스트·객체·배치와 여러 장표 수정안을 검토·적용한다. 객체 탭은 로컬 이미지 등록, 실제 차트 수치 입력, 객체 선택을 맡는다. 선택 버튼의 aria-pressed와 장표 수·객체 수를 함께 표시하고 Ctrl/⌘ 없이도 여러 장표를 고를 수 있다. 캔버스 드래그 핸들은 아직 제공하지 않는다.

## 장표 객체와 일괄 수정

이미지 정규화는 기존 Sharp 0.35.5, 이미지·도형·텍스트·네이티브 차트 출력은 기존 python-pptx 1.0.2와 전이 Pillow를 재사용한다. [공식 차트 API](https://python-pptx.readthedocs.io/en/latest/user/charts.html)의 CategoryChartData/add_chart로 데이터 workbook을 포함하고 [그림·도형 API](https://python-pptx.readthedocs.io/en/latest/api/shapes.html)를 사용한다. 별도 캔버스/차트 런타임이나 외부 편집 SaaS를 추가하지 않는다. Sharp의 실제 디코더로 PNG/JPEG/WebP·화소 수·페이지 수를 검사하고 메타데이터를 제거한 PNG를 만든다. React는 기존 Query/Zustand/shadcn으로 범위 선택·이미지 등록·데이터 검토를 구성한다.

## 문서 실행 의존성과 진행 표시

문서·템플릿 작업은 `workflows/engine`의 공통 Driver를 사용하며 `apalis-core`를 Cargo manifest/lock에서 제거했다. 목차 생성·내용 연결도 같은 엔진 Driver와 기존 Tokio/SQLite를 사용한다. 새 런타임 의존성은 추가하지 않았다. Tokio의 제한된 두 실행 슬롯·CancellationToken·작업 join, 기존 async-sqlite/SQLite lease와 체크포인트, refinery migration을 사용한다. Kordoc·PPT Master·Comrak과 모델 실행 경계는 유지한다.

준비 상태는 기존 Lucide 아이콘과 shadcn Progress/Button으로 표시한다. Modern Web Guidance `progress`의 측정 가능한 값만 표시하고 완료 시 초점을 이동하지 않는 지침을 적용한다. 추출 중에는 단계·텍스트 상태를, 분류 중에는 완료 블록 수의 실제 비율을 표시한다. 강제 색상에서도 현재 단계의 경계를 보존한다. 새 UI/훅/큐 라이브러리는 도입하지 않는다.

## Native source reuse runtime

Native source insertion uses the already pinned python-pptx 1.0.2 and PPT Master runtime. `presentation-references.py` is the product adapter over their OPC/shape model; no new merger dependency or runtime installer was added. The adapter copies native parts, chart workbooks and source theme/layout relationships, remaps IDs and preserves image/source aspect ratios. Source validation, quotas, revision commits and model allowlists remain product responsibilities.

The investigated [pptx-slide-merger](https://github.com/rwunsch/pptx-slide-merger) explicitly excludes charts/OLE in its current README and is not installed. The working implementation is verified with native chart/workbook fixtures rather than treating a dependency review as format fidelity proof. Browser selection reuses shadcn Dialog/Select/Button and existing Query/Axios; DialogTrigger is the existing official Radix primitive alias. No UI package family was changed.

## Canvas direct interaction

Outline generation scope uses the official [shadcn/ui Radix Checkbox](https://ui.shadcn.com/docs/components/radix/checkbox) source and pinned `@radix-ui/react-checkbox` **1.4.1** (MIT, React/React DOM 16.8–19 peers). Its registry URL/hash are recorded in `frontend/components.sources.json`; Folio colors, mixed-state icon and label target sizing are local bindings. Radix owns keyboard, form and checked/indeterminate behavior. Generation scope rules, revision drafts and server validation remain product responsibilities. This adds one consumed browser primitive without changing the existing Radix component family.

| Dependency                     | Version                 | Actual consumer                                                         | Runtime/build boundary                                       |
| ------------------------------ | ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| react-rnd                      | 10.5.3                  | ObjectSelection: drag/resize, bounds and aspect lock                    | Vite browser bundle; MIT, React/React DOM >=16.3 peers       |
| react-draggable / re-resizable | pnpm lockfile pins      | react-rnd gesture/resize implementation                                 | Transitive browser runtime; no application-time installation |
| python-pptx / lxml / Sharp     | Existing pinned runtime | Native layout catalog, authored empty slides and passive artwork layers | Bundled local process adapters; no new server package        |

The [react-rnd upstream documentation](https://github.com/bokuweb/react-rnd) defines controlled position/size, resize/drag callbacks, bounds and aspect lock. Product code owns IDs, percentage geometry, group clamping, cancellation, keyboard/numeric alternatives, immutable revision commits and shared CAS. The library does not own provider calls, data storage or application authorization. Dependencies remain pinned in manifests/lockfiles and are installed during development/build only.
