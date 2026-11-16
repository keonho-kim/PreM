// Purpose: Collect URL-bound library search and lifecycle filters.
// Pattern: Local form drafts are applied together by the owning route.
// Usage: SpaceDirectory supplies the current query and navigation callback.
// Related: space-directory.tsx, api.ts, space.css.
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
export function SpaceFilters({
  q,
  status,
  onSubmit,
}: {
  q: string;
  status: string;
  onSubmit: (q: string, status: string) => void;
}) {
  const [state, setState] = useState(status);
  return (
    <form
      className="space-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(q, state);
      }}
    >
      <div>
        <Label htmlFor="space-status">상태</Label>
        <Select value={state} onValueChange={setState}>
          <SelectTrigger id="space-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">활성</SelectItem>
            <SelectItem value="archived">보관됨</SelectItem>
            <SelectItem value="all">전체</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" variant="secondary">
        적용
      </Button>
      <Button variant="ghost" asChild>
        <Link to="/search">자료 통합 검색</Link>
      </Button>
      {(q || status !== 'active') && (
        <Button variant="ghost" onClick={() => onSubmit('', 'active')}>
          초기화
        </Button>
      )}
    </form>
  );
}
