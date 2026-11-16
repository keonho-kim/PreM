// Purpose: List the actual mock routes and their screenshot names.
// Pattern: Declarative screen inventory shared by capture tools.
// Usage: Required by mock/helpers/capture.cjs.
// Related: mock/index.html, mock/helpers/compose.swift.
const project = 'platform';
const screens = [
  ['Home', 'projects'],
  ['프로젝트 개요', 'overview'],
  ['원본 문서', 'documents'],
  ['작성 방향', 'guide'],
  ['목차 정리', 'outline'],
  ['참고 자료 찾기', 'references'],
  ['템플릿 탐색', 'templates'],
  ['PPT 생성과 목록', 'presentations'],
  ['PPT 편집기', 'editor', { deck: 'deck1' }],
  ['작업 이력', 'history'],
  ['AI 연결', 'admin', { tab: 'providers' }],
  ['업무별 AI', 'admin', { tab: 'routing' }],
  ['Space 참고 자료', 'space', { tab: 'references' }],
  ['Space 템플릿', 'space', { tab: 'templates' }],
  ['작업 현황', 'admin', { tab: 'monitor' }],
  ['서비스 상태', 'admin', { tab: 'system' }],
].map(([title, view, extra = {}]) => {
  const params = new URLSearchParams({ view, project, ...extra });
  return { title, hash: '#' + params, slug: params.toString().replace(/[^\w-]+/g, '-') };
});
module.exports = screens;
