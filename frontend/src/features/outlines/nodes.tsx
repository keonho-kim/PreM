// Purpose: Edit a two-level presentation outline with keyboard-operable add/move/delete commands.
// Pattern: Stable keyed rows; one status announcement per explicit reorder, no CSS-only ordering.
// Usage: OutlineEditor owns the draft and persistence version.
// Related: draft.ts, workspace.tsx, outlines.css.
import { useState } from 'react';
import { Plus, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { Draft } from './api';
import { add, move, remove, update } from './draft';
export function OutlineNodes({
  draft,
  disabled,
  selected,
  onSelect,
  onChange,
}: {
  draft: Draft;
  disabled: boolean;
  selected: string;
  onSelect: (id: string) => void;
  onChange: (d: Draft) => void;
}) {
  const [notice, setNotice] = useState('');
  return (
    <section aria-label="목차 편집">
      <header className="outline-section-heading">
        <h3>발표 순서</h3>
        <Button
          variant="secondary"
          disabled={disabled || draft.nodes.length >= 24}
          onClick={() => onChange(add(draft, null))}
        >
          <Plus aria-hidden="true" />
          대목차 추가
        </Button>
      </header>
      <ol className="outline-node-list">
        {draft.nodes.map((node, index) => {
          const peers = draft.nodes.filter((n) => n.parent_id === node.parent_id),
            position = peers.findIndex((n) => n.id === node.id),
            hasChildren = draft.nodes.some((n) => n.parent_id === node.id);
          return (
            <li key={node.id} data-node={node.id} className={node.parent_id ? 'outline-child' : ''}>
              <div className="outline-node-line">
                <span className="muted">{index + 1}</span>
                <Label className="sr-only" htmlFor={`outline-title-${node.id}`}>
                  {index + 1}번 목차 제목
                </Label>
                <Input
                  id={`outline-title-${node.id}`}
                  value={node.title}
                  maxLength={120}
                  readOnly={disabled}
                  onFocus={() => onSelect(node.id)}
                  onChange={(e) => onChange(update(draft, node.id, { title: e.target.value }))}
                />
                <div className="outline-node-actions">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${node.title} 위로`}
                    disabled={disabled}
                    aria-disabled={position === 0}
                    onClick={() => {
                      if (position === 0) return;
                      onChange(move(draft, node.id, -1));
                      setNotice(`${node.title} 목차를 위로 이동했습니다.`);
                    }}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${node.title} 아래로`}
                    disabled={disabled}
                    aria-disabled={position === peers.length - 1}
                    onClick={() => {
                      if (position === peers.length - 1) return;
                      onChange(move(draft, node.id, 1));
                      setNotice(`${node.title} 목차를 아래로 이동했습니다.`);
                    }}
                  >
                    <ArrowDown />
                  </Button>
                  {!node.parent_id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${node.title}에 중목차 추가`}
                      disabled={disabled || draft.nodes.length >= 24}
                      onClick={() => onChange(add(draft, node.id))}
                    >
                      <Plus />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${node.title} 삭제`}
                    disabled={disabled}
                    onClick={() => {
                      onChange(remove(draft, node.id));
                      setNotice(
                        `${node.title}${hasChildren ? '와 하위 목차를' : '를'} 삭제했습니다. 저장 전에는 변경을 취소할 수 있습니다.`,
                      );
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              {selected === node.id && (
                <div className="outline-node-details">
                  <div>
                    <Label htmlFor={`outline-parent-${node.id}`}>구분</Label>
                    <Select
                      value={node.parent_id ?? 'root'}
                      disabled={disabled || hasChildren}
                      onValueChange={(v) =>
                        onChange(update(draft, node.id, { parent_id: v === 'root' ? null : v }))
                      }
                    >
                      <SelectTrigger id={`outline-parent-${node.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="root">대목차</SelectItem>
                        {draft.nodes
                          .filter((n) => !n.parent_id && n.id !== node.id)
                          .map((n) => (
                            <SelectItem key={n.id} value={n.id}>
                              {n.title}의 중목차
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`outline-description-${node.id}`}>다룰 내용</Label>
                    <Textarea
                      id={`outline-description-${node.id}`}
                      value={node.description}
                      rows={2}
                      maxLength={1000}
                      readOnly={disabled}
                      onChange={(e) =>
                        onChange(update(draft, node.id, { description: e.target.value }))
                      }
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p role="status" className="field-hint">
        {notice}
      </p>
    </section>
  );
}
