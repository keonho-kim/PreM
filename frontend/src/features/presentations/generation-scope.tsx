// Purpose: Select outline branches or individual sections for one generated presentation.
// Pattern: Controlled shadcn checkboxes; parents expose partial selection without owning remote state.
// Usage: GenerationForm owns revision-scoped drafts and validates before submission.
// Related: api.ts, generation-scope.css, backend/presentations/selection.rs.
import { useId } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { GenerationSection } from './api';
import './generation-scope.css';
export function scopeLeaves(rows: GenerationSection[], root?: string): string[] {
  const descendants = (id: string): string[] => {
    const children = rows.filter((n) => n.parent_id === id);
    return children.length ? children.flatMap((n) => descendants(n.id)) : [id];
  };
  return root
    ? descendants(root)
    : rows.filter((n) => !rows.some((c) => c.parent_id === n.id)).map((n) => n.id);
}
export function GenerationScope({
  sections,
  selected,
  disabled,
  onChange,
  onEdit,
  onAdd,
}: {
  sections: GenerationSection[];
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
  onEdit?: (id: string) => void;
  onAdd?: (id: string) => void;
}) {
  const prefix = useId(),
    all = scopeLeaves(sections);
  const state = (ids: string[]) =>
    ids.length > 0 && ids.every((id) => selected.includes(id))
      ? true
      : ids.some((id) => selected.includes(id))
        ? ('indeterminate' as const)
        : false;
  const toggle = (ids: string[]) => {
    const next = new Set(selected),
      remove = ids.every((id) => next.has(id));
    for (const id of ids) {
      if (remove) next.delete(id);
      else next.add(id);
    }
    onChange(all.filter((id) => next.has(id)));
  };
  const choice = (id: string, title: string, ids: string[]) => (
    <span className="generation-scope-entry">
      <label className="generation-scope-row" htmlFor={`${prefix}-${id}`}>
        <Checkbox
          id={`${prefix}-${id}`}
          checked={state(ids)}
          disabled={disabled || !ids.length}
          onCheckedChange={() => toggle(ids)}
        />
        <span>{title}</span>
      </label>
      {id !== 'all' && onEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="generation-outline-action"
          aria-label={`${title} 수정`}
          title="제목·순서 수정"
          disabled={disabled}
          onClick={() => onEdit(id)}
        >
          <Pencil aria-hidden="true" />
        </Button>
      )}
      {id !== 'all' && onAdd && sections.some((n) => n.id === id && n.parent_id === null) && (
        <Button
          variant="ghost"
          size="icon"
          className="generation-outline-action"
          aria-label={`${title}에 중목차 추가`}
          title="중목차 추가"
          disabled={disabled || sections.length >= 24}
          onClick={() => onAdd(id)}
        >
          <Plus aria-hidden="true" />
        </Button>
      )}
    </span>
  );
  return (
    <fieldset className="generation-scope" disabled={disabled}>
      <legend>생성할 목차</legend>
      <p className="muted">
        대목차를 선택하면 하위 중목차가 함께 선택됩니다. 선택하지 않은 부분은 이번 PPT에서
        제외됩니다.
      </p>
      <div className="generation-scope-summary">
        {choice('all', '전체 목차', all)}
        <output aria-live="polite">
          {selected.length}개 선택 · 목차 기준 {selected.length}장
        </output>
      </div>
      <section className="generation-scope-list" aria-label="생성할 목차 목록">
        {!sections.length && <p role="status">확정한 목차가 없습니다.</p>}
        {sections
          .filter((n) => n.parent_id === null)
          .map((root) => (
            <fieldset key={root.id} className="generation-scope-branch">
              <legend>{choice(root.id, root.title, scopeLeaves(sections, root.id))}</legend>
              {sections
                .filter((n) => n.parent_id === root.id)
                .map((child) => (
                  <div key={child.id} className="generation-scope-child">
                    {choice(child.id, child.title, scopeLeaves(sections, child.id))}
                  </div>
                ))}
            </fieldset>
          ))}
      </section>
    </fieldset>
  );
}
