// Purpose: Keep extracted reference parts together under their original slide heading.
// Pattern: The server orders by slide ordinal; stable page IDs define group identity.
// Usage: Both the material gallery and extracted text reader supply their own rendering.
// Related: content.tsx, reference-materials.tsx, processing.css.
import type { ReactNode } from 'react';

export function SlideGroups<T extends { page_id: string }>({
  items,
  label,
  children,
}: {
  items: T[];
  label: (first: T) => string;
  children: (group: T[]) => ReactNode;
}) {
  const slides = new Map<string, [T, ...T[]]>();
  for (const item of items) {
    const group = slides.get(item.page_id);
    if (group) group.push(item);
    else slides.set(item.page_id, [item]);
  }
  return Array.from(slides, ([id, group]) => (
    <section className="reference-slide" key={id}>
      <h2>{label(group[0])}</h2>
      {children(group)}
    </section>
  ));
}
