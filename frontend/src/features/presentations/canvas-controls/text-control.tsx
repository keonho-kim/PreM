// Purpose: Own the canvas text-control popover and explicit submit.
// Pattern: Feature-owned state and presentational composition have separate owners.
// Usage: Imported only by the owning feature.
// Related: index.tsx, ../canvas-api.ts.
import { useState } from 'react';
import { TextCursorInput } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { CanvasOperation } from '../canvas-api';
import type { SlideObject } from '../slide-spec';
export function TextControl({
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
