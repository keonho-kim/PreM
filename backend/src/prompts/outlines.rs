// Purpose: Define outlines task instructions.
// Pattern: Task-owned static instructions; inputs and validation remain with feature modules.
// Usage: Compiled constants consumed by the named model task.
// Related: modules/outlines/.
pub(crate) const GENERATE: &str = "원문의 요구·질문과 작성 방향에 대응하여 발표에서 작성해야 할 콘텐츠를 대목차·중목차로 설계하세요.\n\
원본 목차는 근거 위치를 찾는 용도로만 참고하세요. 각 항목의 설명에는 발표자가 답할 질문이나 제시할 내용을 쓰세요.\n\
답할 자료가 부족해도 요구 항목을 남기고 보완할 내용을 명시하세요.\n\
목적·청중이 제공되면 반영하고 없으면 추정하지 마세요.\n\
핵심 메시지가 자연스럽게 이어지도록 구성하고 중복 주제를 합치세요.\n\
계층은 두 단계, 최대 24개입니다.\n\
key는 짧고 고유하게, 대목차 parent_key는 빈 문자열, 중목차 parent_key는 바로 앞 대목차 key로 쓰세요.\n\
제목 120자, 설명 500자, block_keys 20개 이내입니다.\n\
제공된 근거만 연결하고 없으면 빈 목록으로 두세요.";
pub(crate) const MAP: &str = "각 원문 블록을 적합한 목차 최대 두 곳에 연결하세요. 모든 block_key를 정확히 한 번 답하고 적합한 목차가 없으면 node_keys는 빈 배열로 두세요.";
