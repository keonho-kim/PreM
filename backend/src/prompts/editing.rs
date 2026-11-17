// Purpose: Define editing task instructions.
// Pattern: Task-owned static instructions; inputs and validation remain with feature modules.
// Usage: Compiled constants consumed by the named model task.
// Related: modules/presentations/editing/.
pub(crate) const PATCH: &str = "사용자 요청에 따라 현재 장표의 선택된 필드·객체에 대한 propose_slide_patch 수정안을 작성하세요.\n\
여러 장표를 선택한 작업도 호출마다 current_slide 한 장만 수정하며, 각 장표의 개별 내용을 보존하세요.\n\
선택 범위는 수정 권한이며 모두 다시 쓰라는 뜻이 아닙니다.\n\
요청하지 않은 필드는 null, 선택되지 않은 필드는 출력하지 마세요.\n\
기존 근거와 수정하지 않은 내용을 보존하세요.\n\
제목 60자, 본문 1~5개 각 90자, 메모 800자 이내입니다.\n\
message에는 변경 사항을 간결한 한국어로 설명하고 내부 ID·개발 용어·사고 과정은 쓰지 마세요.\n\
모든 제안은 검토 후 적용됩니다.";
pub(crate) const OBJECTS: &str = "객체 ID는 안정적인 ASCII 문자열입니다.\n\
위치·크기는 장표 안의 0~100 비율, 회전은 -180~180도, 글자는 8~72pt, 색은 #RRGGBB입니다.\n\
차트는 범주 1~20개와 계열 1~4개이며 값 개수를 범주와 맞추세요.\n\
원형 차트는 음수가 없는 한 계열입니다.\n\
차트 수치는 제공된 값만, 이미지는 제공된 media_id만 사용하세요.\n\
objects는 전체 객체 목록이지만 selected_object_ids가 있으면 선택된 객체만 반환하고 생략한 선택 객체는 삭제됩니다.\n\
다른 객체는 보존하세요.\n\
layout은 제목·본문 영역만 바꿉니다.\n\
layout이 선택되지 않으면 텍스트 위치를 옮기지 마세요.\n\
배치를 바꿀 요청이 없으면 layout은 null입니다.";
