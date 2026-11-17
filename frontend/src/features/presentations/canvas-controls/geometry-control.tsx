// Purpose: Own the canvas geometry-control popover and explicit submit.
// Pattern: Feature-owned state and presentational composition have separate owners.
// Usage: Imported only by the owning feature.
// Related: index.tsx, ../canvas-api.ts.
import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { CanvasOperation } from '../canvas-api';
import type { SlideObject } from '../slide-spec';
export function GeometryControl({
  object,
  enabled,
  onApply,
}: {
  object: SlideObject;
  enabled: boolean;
  onApply: (o: CanvasOperation) => void;
}) {
  const [open, setOpen] = useState(false),
    [values, setValues] = useState({
      x: String(object.frame.x),
      y: String(object.frame.y),
      width: String(object.frame.width),
      height: String(object.frame.height),
    }),
    [error, setError] = useState('');
  const frame = {
    ...object.frame,
    x: Number(values.x),
    y: Number(values.y),
    width: Number(values.width),
    height: Number(values.height),
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="선택한 객체 위치·크기"
          title="위치·크기 입력"
          disabled={!enabled}
        >
          <SlidersHorizontal aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <form
          className="canvas-position-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              [frame.x, frame.y, frame.width, frame.height].some((n) => !Number.isFinite(n)) ||
              frame.x < 0 ||
              frame.y < 0 ||
              frame.width < 1 ||
              frame.height < 1 ||
              frame.x + frame.width > 100 ||
              frame.y + frame.height > 100
            ) {
              setError('객체가 장표 안에 들어오도록 위치와 크기를 입력하세요.');
              return;
            }
            onApply({ kind: 'geometry', placements: [{ object_id: object.id, frame }] });
            setOpen(false);
          }}
        >
          <p>{object.name} · 장표 크기에 대한 비율입니다.</p>
          {(
            [
              ['x', '가로 위치 (%)'],
              ['y', '세로 위치 (%)'],
              ['width', '너비 (%)'],
              ['height', '높이 (%)'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <Label htmlFor={`canvas-${key}`}>{label}</Label>
              <Input
                id={`canvas-${key}`}
                type="number"
                required
                step="any"
                min={key === 'width' || key === 'height' ? 1 : 0}
                max={100}
                value={values[key]}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              />
            </div>
          ))}
          {error && <p role="alert">{error}</p>}
          <footer>
            <Button type="submit">배치 적용</Button>
          </footer>
        </form>
      </PopoverContent>
    </Popover>
  );
}
