// Purpose: Display real current/proposed/previous slide papers and own image aspect measurements.
// Pattern: Both comparison images stay mounted, so holding the button does not refetch or flicker.
// Usage: DeckPreview owns review state and toolbar; this view never commits slide data.
// Related: deck-review.css, object-selection.tsx, use-deck-review.ts.
import { useState, type CSSProperties } from 'react';
import type { Slide } from './api';
import type { Placements } from './canvas-geometry';
import './canvas-editing.css';
import { CanvasLayers } from './canvas-layers';
import { ObjectSelection } from './object-selection';
export function DeckCanvas({
  current,
  displayed,
  published,
  beforeUrl,
  afterUrl,
  comparing,
  proposal,
  zoom,
  selectedObjects,
  onSelect,
  onBeforeReady,
  editable = false,
  onGeometry,
  layerScope,
}: {
  current: Slide | undefined;
  displayed: Slide | undefined;
  published: boolean;
  beforeUrl: string | null;
  afterUrl: string | null;
  comparing: boolean;
  proposal: boolean;
  zoom: number;
  selectedObjects: string[];
  onSelect: (id: string, multiple: boolean) => void;
  onBeforeReady: (url: string | null) => void;
  editable?: boolean;
  onGeometry?: (frames: Placements) => void;
  layerScope?: { project: string; run: string };
}) {
  const [draft, setDraft] = useState<Placements>({});
  const [ratio, setRatio] = useState(16 / 9),
    [beforeRatio, setBeforeRatio] = useState(16 / 9);
  return (
    <>
      <div className="presentation-canvas-well">
        <div
          className="presentation-canvas-paper"
          style={
            {
              '--preview-ratio': comparing ? beforeRatio : ratio,
              '--preview-zoom': zoom / 100,
            } as CSSProperties
          }
        >
          {beforeUrl && (
            <img
              key={beforeUrl}
              className={comparing ? 'presentation-output' : 'presentation-before-preload'}
              src={beforeUrl}
              data-preview="before"
              alt={comparing ? '수정 전 장표' : ''}
              aria-hidden={!comparing}
              onLoad={(e) => {
                setBeforeRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight);
                onBeforeReady(beforeUrl);
              }}
              onError={() => onBeforeReady(null)}
            />
          )}
          {current?.preview && afterUrl && published ? (
            <img
              className={comparing ? 'presentation-current-hidden' : 'presentation-output'}
              onLoad={(e) => {
                const image = e.currentTarget;
                if (image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight);
              }}
              src={afterUrl}
              data-preview={proposal ? 'proposal' : 'current'}
              alt={displayed?.spec?.title || '빈 슬라이드'}
              aria-hidden={comparing}
            />
          ) : current?.spec ? (
            <article className="presentation-draft">
              <p className="field-hint">내용 초안 · 완성 전</p>
              <h3>{current.spec.title}</h3>
              <ul>
                {current.spec.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </article>
          ) : (
            <p className="related-empty">슬라이드 내용이 준비되면 이곳에 표시됩니다.</p>
          )}
          {layerScope && current?.preview && published && !proposal && !comparing && (
            <CanvasLayers
              key={`${layerScope.run}:${current.id}`}
              project={layerScope.project}
              run={layerScope.run}
              slide={current.id}
              objects={current.spec?.objects ?? []}
              draft={draft}
            />
          )}
          {current?.preview && published && !proposal && !comparing && (
            <ObjectSelection
              objects={current.spec?.objects ?? []}
              selected={selectedObjects}
              onSelect={onSelect}
              enabled={editable}
              onCommit={onGeometry}
              onDraft={setDraft}
            />
          )}
        </div>
      </div>
      <p className="presentation-canvas-caption">
        {comparing
          ? '수정 전'
          : proposal
            ? '수정안 · 아직 적용하지 않음'
            : current?.spec?.title || '빈 슬라이드'}
      </p>
    </>
  );
}
