# 목업 개발 도구

목업의 실행·브라우저 검증·캡처 도구다. 제품 런타임과 분리한다. 준비 환경과 기능별 테스트 범위는 [품질·검증 문서](../../dev-docs/07-quality-readiness.md)를 따른다.

## 주요 진입점

| 파일                             | 책임                                  |
| -------------------------------- | ------------------------------------- |
| `serve.py`                       | loopback 정적 서버                    |
| `browser.cjs`                    | 브라우저 해석, 격리 프로필, 종료·정리 |
| `screens.cjs`                    | 화면 라우트와 캡처 목록               |
| `smoke.cjs`                      | 주요 제품 흐름 검증                   |
| `workspace-flow.cjs`             | Studio 진도·역할·Space 검증           |
| `search-editor.cjs`              | 검색·Reference·탭 검증                |
| `editor-basics.cjs`              | 슬라이드·객체 편집 검증               |
| `editor-failures.cjs`            | 입력·편집 실패와 취소 검증            |
| `editor-chat.cjs`                | 다중 선택·대화 범위·수정안 검증       |
| `capture.cjs`, `theme-check.cjs` | 화면 캡처와 디자인 검사               |
| `check-production-theme.cjs`     | 빌드한 React 화면 검사                |
| `compose.swift`                  | 캡처 이미지 모음 생성                 |

## 실행

저장소 루트에서 정적 서버를 실행한 뒤 별도 터미널에서 검사를 실행한다.

```sh
python3 mock/helpers/serve.py
```

```sh
node mock/helpers/editor-chat.cjs
node mock/helpers/capture.cjs
```

브라우저 도구 위치는 `PUPUTYX_BROWSER_TOOLS`, 브라우저 실행 파일은 `CHROME_PATH`, 목업 주소는 `PUPUTYX_MOCK_URL`로 지정한다. 세부 조건은 [브라우저 검사 설정](../../dev-docs/07-quality-readiness.md)에 있다.

macOS에서 캡처 모음을 생성하려면:

```sh
mkdir -p mock/helpers/.artifacts/module-cache
CLANG_MODULE_CACHE_PATH="$PWD/mock/helpers/.artifacts/module-cache" \
  swift -module-cache-path "$PWD/mock/helpers/.artifacts/module-cache" \
  mock/helpers/compose.swift "$PWD/mock/captures/folio"
```

## 산출물

캡처·모음 이미지는 `mock/captures/folio/`에 저장한다. `.artifacts/`는 보고서, 임시 fixture, 브라우저 프로필, 다운로드, 컴파일 캐시를 소유한다. 검증 후 임시 자료를 정리하고 유효한 보고서는 구분해 보관한다. `data/`에는 개발 도구 자료를 저장하지 않는다.

프로젝트 메뉴는 `node mock/helpers/project-menu.cjs`, 갤러리·종료일·달력·D-Day·페이지네이션은 `node mock/helpers/project-gallery.cjs`로 검사한다. 기존 브라우저 도구 설정과 캡처 위치를 사용한다.

`node mock/helpers/project-create.cjs`는 우측 하단 FAB와 목록·카드 우클릭 생성 경로, 키보드·빈 결과·모바일·fallback을 검사한다.

`node mock/helpers/asset-preview.cjs`는 5174 정적 서버와 직접 파일 열기로 Space/Studio 템플릿 미리보기, 장표 선택, 닫기·초점 복귀, 390/320px 배치, 레퍼런스와 메타데이터 전용 업로드를 검사한다. 캡처는 `mock/captures/folio/mock-template-preview.png`와 `mock-template-preview-phone.png`다.

`node mock/helpers/office-language.cjs`는 일반 사무직용 표현을 16개 화면과 주요 입력·편집·진행 대화 상자에서 확인한다. 내부 개발 용어·QA 컨트롤·가로 넘침을 검사하고 상세 설정의 기본 접힘과 정직한 샘플 안내를 확인한다. 결과는 `.artifacts/office-language-report.json`에 저장한다.
