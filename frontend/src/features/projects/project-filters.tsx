// Purpose: Own the Home filter draft using shared shadcn form controls.
// Pattern: Submit committed filters to the URL; selection alone never navigates.
// Usage: ProjectDirectory supplies committed filters and a navigation callback.
// Related: api.ts, due-date-picker.tsx, pages/projects-page.tsx.
import { useId, useState } from 'react';
import { Search, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { defaultFilters, type ProjectFilters } from './api';
import { DueDatePicker } from './due-date-picker';
export function ProjectFilterForm(props: {
  filters: ProjectFilters;
  onChange: (filters: ProjectFilters) => void;
}) {
  return <FilterDraft key={JSON.stringify(props.filters)} {...props} />;
}
function FilterDraft({
  filters,
  onChange,
}: {
  filters: ProjectFilters;
  onChange: (filters: ProjectFilters) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(filters);
  return (
    <form
      className="project-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onChange({ ...draft, q: draft.q.trim() });
      }}
    >
      <div className="project-search filter-field">
        <Label htmlFor={`${id}-q`}>프로젝트 검색</Label>
        <Input
          id={`${id}-q`}
          name="q"
          type="search"
          maxLength={80}
          value={draft.q}
          onChange={(event) => setDraft({ ...draft, q: event.target.value })}
          placeholder="프로젝트 이름"
        />
      </div>
      <div className="filter-field">
        <Label htmlFor={`${id}-status`}>상태</Label>
        <Select
          name="status"
          value={draft.status}
          onValueChange={(value) =>
            setDraft({ ...draft, status: value as ProjectFilters['status'] })
          }
        >
          <SelectTrigger id={`${id}-status`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">진행 중</SelectItem>
            <SelectItem value="archived">보관됨</SelectItem>
            <SelectItem value="all">전체</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="filter-field">
        <Label htmlFor={`${id}-due`}>마감일</Label>
        <DueDatePicker
          id={`${id}-due`}
          value={draft.due_date}
          onChange={(value) => setDraft({ ...draft, due_date: value })}
        />
      </div>
      <div className="filter-field">
        <Label htmlFor={`${id}-sort`}>정렬</Label>
        <Select
          name="sort"
          value={draft.sort}
          onValueChange={(value) => setDraft({ ...draft, sort: value as ProjectFilters['sort'] })}
        >
          <SelectTrigger id={`${id}-sort`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">최근 변경순</SelectItem>
            <SelectItem value="deadline">마감일순</SelectItem>
            <SelectItem value="name">이름순</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" variant="secondary">
        <Search aria-hidden="true" />
        검색
      </Button>
      <Button
        variant="secondary"
        size="icon"
        aria-label="검색 조건 초기화"
        title="검색 조건 초기화"
        onClick={() => onChange(defaultFilters)}
      >
        <RotateCcw aria-hidden="true" />
      </Button>
    </form>
  );
}
