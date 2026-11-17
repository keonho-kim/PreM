# PreM runtime

문서 처리에 사용하는 고정 버전의 로컬 실행 도구를 보관한다. `pnpm runtime:install`은 명시적인 개발·빌드 단계에서 Node 26.13.0, CPython 3.13.18, Kordoc 4.24.80, 인쇄 한국어 OCR 모델과 PPT Master 소스를 준비한다. uv·npm·tar는 설치 단계의 개발 도구이며 앱 실행 시 호출하지 않는다.

- `node/`, `python/`: 번들된 플랫폼별 실행기.
- `kordoc/`: lockfile 기반 Node 의존성, PDFium·Sharp·ONNX Runtime, OCR 모델.
- `ppt-master/source/`: 공식 소스와 라이선스·귀속 검사. 고정 커밋은 `REVISION`, 취득 아카이브 해시는 `ARCHIVE_SHA256`에 기록한다.
- `document-extract.mjs`, `template-extract.py`, `template-previews.mjs`, `process-parent-watch.mjs`: `backend/tools/`에서 빌드 시 복사한 실행 어댑터.
- `document-manifest.json`: 실행기·플랫폼·어댑터·모델 버전과 해시. `node scripts/prepare-document-runtime.mjs`로 생성하며 앱 시작은 설치·다운로드를 수행하지 않는다.

템플릿은 PPT Master의 편집 구조와 슬라이드 SVG를 추출하고 Sharp로 수동 실행 요소가 없는 PNG 미리보기를 만든다. 레퍼런스는 Kordoc 또는 HTML 파서로 내용을 추출한다. 도구 작업 파일과 쓰기 가능한 OCR 캐시는 설정된 앱 데이터 경로에 둔다. 원본·결과는 공통 Blob으로 보존한다.

현재 macOS arm64에서 실제 실행을 검증한다. Linux용 패키지는 해당 플랫폼에서 생성·검증해야 한다. LibreOffice·H2Orestart·Java 기반 Office PDF 정규화는 아직 제품에 연결되지 않았다. 이 폴더의 존재만으로 전체 릴리스 검증을 완료한 것으로 간주하지 않는다.

릴리스 패키지는 `scripts/package-release.py`가 준비된 호스트용 실행기·도구·모델과 한국어 폰트를 복사한다. 실행은 루트의 `PreM` launcher를 사용하며 앱 데이터 경로에 폰트 캐시를 둔다. 설치 절대 경로가 바뀌어도 동작하도록 패키지의 상대 경로를 사용한다. `scripts/verify-release.py`는 압축 재배치 후 개발 Node/Python 없이 네이티브 라이브러리·OCR 모델·PPTX/PNG와 HTTP 재시작을 검사한다.
