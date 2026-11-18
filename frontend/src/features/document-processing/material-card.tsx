// Purpose: Display and select an individual reusable reference part.
// Pattern: Source identity stays on each card inside its slide group or ordered review.
// Usage: ReferenceMaterials supplies selection state and review order.
// Related: reference-materials.tsx, reference-materials.css.
import { Check, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fileUrl } from './api';
import type { Material } from './materials-api';
const labels = {
  slide: '장표',
  page: '페이지',
  image: '이미지',
  diagram: '도형·도식',
  chart: '차트',
  text: '글',
  table: '표',
};
export function MaterialCard({
  item,
  job,
  reviewNumber,
  grouped,
  selected,
  disabled,
  onSelect,
}: {
  item: Material;
  job: string;
  reviewNumber?: number;
  grouped: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <article className="material-card">
      {item.preview ? (
        <div className="material-image">
          <img
            src={fileUrl(job, item.preview)}
            loading="lazy"
            decoding="async"
            alt={`${item.page_label} · ${labels[item.kind]}${item.preview_scope === 'page' ? '가 포함된 원본 페이지' : ''}`}
          />
        </div>
      ) : (
        <section
          className="material-text"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Named source-text viewport needs keyboard scrolling.
          tabIndex={0}
          aria-label={`${item.page_label} 본문`}
        >
          <p>{item.text || item.title}</p>
        </section>
      )}
      <div className="material-caption">
        <div>
          <span>
            {reviewNumber ? `${reviewNumber}. ` : ''}
            {!grouped && `${item.page_label} · `}
            {labels[item.kind]}
          </span>
          <h3>{item.title}</h3>
          {item.preview_scope === 'page' && <small>이 자료가 포함된 원본 페이지</small>}
        </div>
        {!reviewNumber && (
          <Button
            size="icon"
            variant={selected ? 'default' : 'secondary'}
            aria-label={`${item.page_label} ${item.title} 선택`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={onSelect}
          >
            {selected ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
          </Button>
        )}
      </div>
    </article>
  );
}
