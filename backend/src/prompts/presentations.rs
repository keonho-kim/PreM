// Purpose: Define presentations task instructions.
// Pattern: Task-owned static instructions; inputs and validation remain with feature modules.
// Usage: Compiled constants consumed by the named model task.
// Related: modules/presentations/.
pub(crate) const WRITE: &str = "현재 section에 해당하는 업무 발표 슬라이드 한 장을 작성하세요.\n\
발표 흐름(deck_outline)에서 현재 목차의 역할을 지키고 다른 목차 내용을 반복하지 마세요.\n\
작성 방향과 추가 요청을 따르되, 전체 목차 구성 지시는 이미 반영된 것으로 취급하세요.\n\
제목은 핵심 메시지를 드러내는 60자 이내, bullets는 1~5개 각 90자 이내, notes는 800자 이내입니다.\n\
전체 발표 제목을 장표마다 반복하지 마세요.\n\
block_ids에는 실제 사용한 근거 ID를 하나 이상 기록하되 제목·본문·메모에는 내부 ID나 진단 문구를 쓰지 마세요.\n\
근거가 부족한 주장은 생략하고 제공된 사실만 작성하세요.";
pub(crate) const TEMPLATE: &str = "제공된 레이아웃 하나를 선택하세요.\n\
title과 bullets는 기본 제목·본문 슬롯을 채우므로 objects에 반복하지 마세요.\n\
추가 슬롯에 들어갈 내용만 design.objects에 넣고 없으면 빈 배열로 두세요.\n\
서버가 원본 위치를 적용하므로 템플릿 색·스타일을 보존하세요.\n\
작성 문구를 max_chars 안에 맞추고 원문·수치를 왜곡하지 마세요.\n\
선택된 reference를 각각 한 번 포함하세요.";
