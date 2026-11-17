// Purpose: Provide non-drag geometry, text, shape and image commands beside the real canvas.
// Pattern: shadcn controls own focus/dismissal; one explicit command creates one render revision.
// Usage: DeckPreview supplies selection and the scoped canvas command owner.
// Related: canvas-api.ts, media-api.ts, object-selection.tsx, canvas-editing.css.
import { useEffect, useRef, useState } from 'react';
import {
  Type,
  Square,
  ImagePlus,
  SlidersHorizontal,
  TextCursorInput,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { CanvasOperation } from './canvas-api';
import type { SlideObject } from './slide-spec';
import { uploadImage } from './media-api';
import { errorMessage } from '@/shared/api/http';
import { translated, changed } from './canvas-geometry';
export function CanvasControls({
  project,
  objects,
  selected,
  enabled,
  onApply,
}: {
  project: string;
  objects: SlideObject[];
  selected: string[];
  enabled: boolean;
  onApply: (o: CanvasOperation) => void;
}) {
  const file = useRef<HTMLInputElement>(null),
    upload = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState(false),
    [error, setError] = useState('');
  useEffect(() => () => upload.current?.abort(), []);
  useEffect(() => {
    if (!enabled) {
      upload.current?.abort();
      setUploading(false);
    }
  }, [enabled]);
  const object = objects.find((o) => o.id === selected[0]);
  const insert = (content: SlideObject['content'], name: string) =>
    onApply({
      kind: 'insert',
      object: {
        id: `object-${crypto.randomUUID()}`,
        name,
        frame: { x: 15, y: 20, width: 40, height: 20, rotation: 0 },
        content,
      },
    });
  async function image(input: File | undefined) {
    if (!input || !enabled) return;
    setError('');
    if (input.size > 5 * 1024 * 1024) {
      setError('5 MiB 이하의 이미지를 선택하세요.');
      return;
    }
    const controller = new AbortController();
    upload.current = controller;
    setUploading(true);
    try {
      const media = await uploadImage(project, crypto.randomUUID(), input, controller.signal);
      if (controller.signal.aborted) return;
      insert({ kind: 'image', media_id: media.id }, input.name.slice(0, 60));
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setUploading(false);
    }
  }
  return (
    <div className="canvas-direct-controls">
      <fieldset className="canvas-command-strip" aria-label="장표 직접 편집">
        <Button
          variant="ghost"
          size="icon"
          aria-label="텍스트 추가"
          title="텍스트 추가"
          disabled={!enabled || uploading}
          onClick={() =>
            insert(
              { kind: 'text', text: '텍스트를 입력하세요', font_size: 20, color: '#262824' },
              '텍스트',
            )
          }
        >
          <Type aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="도형 추가"
          title="도형 추가"
          disabled={!enabled || uploading}
          onClick={() => insert({ kind: 'shape', shape: 'rectangle', fill: '#E3EAE4' }, '도형')}
        >
          <Square aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="이미지 넣기"
          title="이미지 넣기"
          disabled={!enabled || uploading}
          onClick={() => file.current?.click()}
        >
          <ImagePlus aria-hidden="true" />
        </Button>
        <Input
          ref={file}
          className="canvas-file-input"
          hidden
          type="file"
          aria-label="장표에 넣을 이미지"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            void image(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {object && selected.length === 1 && (
          <GeometryControl
            key={`${object.id}:${JSON.stringify(object.frame)}`}
            object={object}
            enabled={enabled}
            onApply={onApply}
          />
        )}
        {object?.content.kind === 'text' && selected.length === 1 && (
          <TextControl
            key={`${object.id}:${object.content.text}`}
            object={object}
            enabled={enabled}
            onApply={onApply}
          />
        )}
        {selected.length > 1 &&
          [
            { label: '선택한 객체 위로 이동', Icon: ArrowUp, x: 0, y: -1 },
            { label: '선택한 객체 아래로 이동', Icon: ArrowDown, x: 0, y: 1 },
            { label: '선택한 객체 왼쪽으로 이동', Icon: ArrowLeft, x: -1, y: 0 },
            { label: '선택한 객체 오른쪽으로 이동', Icon: ArrowRight, x: 1, y: 0 },
          ].map(({ label, Icon, x, y }) => (
            <Button
              key={label}
              variant="ghost"
              size="icon"
              aria-label={label}
              title={label}
              disabled={!enabled}
              onClick={() => {
                const frames = translated(objects, selected, x, y);
                if (changed(objects, frames))
                  onApply({
                    kind: 'geometry',
                    placements: Object.entries(frames).map(([object_id, frame]) => ({
                      object_id,
                      frame,
                    })),
                  });
              }}
            >
              <Icon aria-hidden="true" />
            </Button>
          ))}
        <span className="field-hint">
          {selected.length
            ? `${selected.length}개 선택 · 방향키로 이동, Shift로 크게 이동`
            : '객체를 선택해 끌어서 이동하세요.'}
        </span>
      </fieldset>
      {uploading && <p role="status">이미지를 준비하고 있습니다.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
function GeometryControl({
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
function TextControl({
  object,
  enabled,
  onApply,
}: {
  object: SlideObject;
  enabled: boolean;
  onApply: (o: CanvasOperation) => void;
}) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState(object.content.kind === 'text' ? object.content.text : '');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={!enabled}
          aria-label="선택한 텍스트 수정"
          title="텍스트 수정"
        >
          <TextCursorInput aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onApply({ kind: 'text', object_id: object.id, text });
            setOpen(false);
          }}
        >
          <Label htmlFor="canvas-text">텍스트</Label>
          <Textarea
            id="canvas-text"
            value={text}
            required
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit">내용 적용</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
