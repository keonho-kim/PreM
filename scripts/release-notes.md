PreM의 날짜 버전 릴리스입니다. TanStack Router·Redux Toolkit·React Hook Form 구성, 작업별 프롬프트 분리와 문맥 입력 보강, Kordoc 4.24.83, 제품 테스트 도구 분리와 오프라인 백업·복원을 포함합니다.

각 `.tar.gz`에는 웹 UI가 포함된 서버, Node·Python, 문서/PPT 처리 도구, 인쇄 한국어 OCR 모델, 한국어 폰트 및 라이선스가 들어 있습니다. 별도 Node·Python·npm 설치 없이 압축을 풀고 실행합니다.

```sh
./PreM --data-storage-path /absolute/path/to/data --listen-address 127.0.0.1 --port 8000
```

브라우저에서 `http://127.0.0.1:8000/home/`을 엽니다. Admin 토큰은 시작 터미널에 출력됩니다. LLM과 Decision 모델 서버는 Admin에서 별도로 연결합니다. 외부 모델 서버와 LLM 가중치는 이 서버 패키지의 설치 의존성이 아닙니다.

- `macos-arm64`: Apple Silicon, macOS 14 이상. Apple 공증은 적용하지 않았습니다.
- `linux-arm64`, `linux-amd64`: glibc 2.39 이상 Linux (Ubuntu 24.04 이상). libc/OS 커널은 호스트가 제공합니다.
- `.sha256`: 다운로드 무결성 확인.
- 압축 내부 `RELEASE.json`: 파일별 해시·버전·플랫폼·소스 커밋.
- 기존 데이터 폴더를 그대로 지정할 수 있습니다. 스키마 업데이트 전에 DB 백업을 생성합니다.

모든 플랫폼에서 번들을 다른 경로로 옮긴 뒤, 개발용 Node/Python이 없는 PATH로 OCR 모델 로딩·스캔 PDF/Office/HWP 추출·PPTX/PNG 생성·HTTP 시작과 재시작을 검사합니다. Linux는 추가 패키지가 없는 Ubuntu 24.04에서도 네트워크 없이 검사합니다. 실제 업무 문서의 추출 품질과 외부 LLM 결과 품질은 모델·문서에 따라 달라집니다.

서버를 종료한 상태에서 `./PreM-maintenance backup --data-storage-path /absolute/data --output /absolute/backups/snapshot.tar.gz`로 DB·파일·키를 함께 보관합니다. `restore --archive /absolute/backups/snapshot.tar.gz --data-storage-path /absolute/new-data`는 새 경로에만 복원합니다. 외부 키를 사용한다면 backup에 `--secret-key-file`도 전달하세요.

알려진 문서 품질 한계: 두 단 PDF 본문이 표로 분류되어 읽기 순서가 달라지는 경우와 XLSX 수식 메타데이터가 보존되지 않는 경우가 고정 corpus에서 확인됐습니다. 표시된 값과 원본 파일은 보존하며, 해당 품질 감사의 실패는 숨기거나 통과 처리하지 않습니다.
