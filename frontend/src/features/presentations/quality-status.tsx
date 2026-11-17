// Purpose: Explain per-slide checks and recoverable layout problems in ordinary office language.
// Pattern: Server-confirmed outcomes only; passive status never moves keyboard focus.
// Usage: Generation and conversational previews share the same bounded report presentation.
// Related: quality-schema.ts, generation.tsx, edit-proposal.tsx.
import type { SlideQuality } from './quality-schema';
const messages: Record<string, string> = {
  text_overflow: '글자가 장표에 모두 들어가지 않습니다. 내용이나 템플릿을 조정해 주세요.',
  text_overlap: '제목과 본문이 겹칩니다. 배치를 조정해 주세요.',
  object_overlap: '겹쳐 놓인 요소가 있습니다. 의도한 배치인지 확인해 주세요.',
  content_overlap: '본문과 참고 자료가 겹칠 수 있습니다. 배치를 확인해 주세요.',
  image_distorted: '이미지 비율을 확인해 주세요.',
  outside_slide: '일부 요소가 장표 밖에 있습니다. 배치를 조정해 주세요.',
  evidence_missing: '내용을 뒷받침할 원본 자료를 다시 선택해 주세요.',
  native_content_missing: '일부 내용이나 도표를 옮기지 못했습니다. 원본 자료를 확인해 주세요.',
  output_text_missing: '저장한 장표에서 일부 글을 확인하지 못했습니다. 내용을 확인해 주세요.',
};
export function QualityStatus({ rows }: { rows?: SlideQuality[] }) {
  if (!rows?.length) return null;
  const failed = rows.filter((r) => !r.report.passed);
  const repaired = rows.filter((r) => r.report.repair_attempts > 0 && r.report.passed);
  const notices = rows.filter((r) => r.report.issues.length > 0);
  return (
    <section className="presentation-quality" aria-label="장표 확인 결과">
      <p role="status">
        {rows.filter((r) => r.report.passed).length}장 확인 완료
        {repaired.length > 0 ? ` · ${repaired.length}장 글자 크기 조정` : ''}
        {failed.length > 0 ? ` · ${failed.length}장 확인 필요` : ''}
      </p>
      {notices.length > 0 && (
        <ul>
          {notices.map((r) => (
            <li key={r.position}>
              {r.position}번 장표 ·{' '}
              {r.report.issues
                .map((i) => messages[i.code] ?? '내용과 배치를 확인해 주세요.')
                .join(' ')}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
