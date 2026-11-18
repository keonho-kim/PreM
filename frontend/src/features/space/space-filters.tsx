// Purpose: Select which lifecycle states appear in the Space list.
// Pattern: Apply the selected lifecycle filter to the current list.
// Usage: SpaceDirectory supplies the current status and navigation callback.
// Related: space-directory.tsx, api.ts, space.css.
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
export function SpaceFilters({
  status,
  onChange,
}: {
  status: string;
  onChange: (status: string) => void;
}) {
  return (
    <div className="space-list-filter">
      <Label htmlFor="space-status">상태</Label>
      <Select value={status} onValueChange={onChange}>
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
  );
}
