// Purpose: Move actual object artwork over its original background during local canvas gestures.
// Pattern: Passive server-produced PNG layers; the canonical full preview stays underneath as fallback.
// Usage: DeckCanvas supplies the current immutable slide and temporary percentage-frame drafts.
// Related: canvas-api.ts, presentation-layers.py, object-selection.tsx.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCanvasLayers, canvasLayerUrl } from './canvas-api';
import type { SlideObject } from './slide-spec';
import type { Placements } from './canvas-geometry';
export function CanvasLayers({
  project,
  run,
  slide,
  objects,
  draft,
}: {
  project: string;
  run: string;
  slide: string;
  objects: SlideObject[];
  draft: Placements;
}) {
  const [loaded, setLoaded] = useState<string[]>([]),
    [broken, setBroken] = useState(false);
  const layers = useQuery({
    queryKey: ['presentation-layers', project, run, slide],
    queryFn: ({ signal }) => getCanvasLayers(project, run, slide, signal),
    staleTime: Infinity,
    retry: false,
  });
  const rows = layers.data ?? [],
    background = rows.find((r) => r.id === 'background');
  if (!background || broken || layers.isError) return null;
  const ready = rows.every((r) => loaded.includes(r.id));
  return (
    <div
      className="canvas-artwork-layers"
      aria-hidden="true"
      style={{ visibility: ready ? 'visible' : 'hidden' }}
    >
      {rows.map((layer) => {
        const f = layer.frame,
          original = objects.find((o) => `object:${o.id}` === layer.id)?.frame,
          next = draft[layer.id.startsWith('object:') ? layer.id.slice(7) : ''];
        let transform = 'none';
        if (original && next) {
          const sx = next.width / original.width,
            sy = next.height / original.height;
          const dx = next.x + (f.x - original.x) * sx - f.x,
            dy = next.y + (f.y - original.y) * sy - f.y;
          transform = `translate(${(dx / f.width) * 100}%,${(dy / f.height) * 100}%) scale(${sx},${sy})`;
        }
        return (
          // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Only PNG load/error events; separate buttons own all pointer and keyboard interactions.
          <img
            key={layer.id}
            src={canvasLayerUrl(project, run, slide, layer.id)}
            alt={layer.id === 'background' ? '장표 배경' : '장표 객체'}
            onLoad={() => setLoaded((ids) => (ids.includes(layer.id) ? ids : [...ids, layer.id]))}
            onError={() => setBroken(true)}
            style={{
              left: `${f.x}%`,
              top: `${f.y}%`,
              width: `${f.width}%`,
              height: `${f.height}%`,
              transform,
              transformOrigin: 'top left',
            }}
          />
        );
      })}
    </div>
  );
}
