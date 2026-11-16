// Purpose: Collect an explicit business-context search and optional corpus filters.
// Pattern: Local drafts submit once; filter changes alone never invoke the model.
// Usage: RelatedDocuments pins each submitted payload and retry key.
// Related: api.ts, features/projects public options, results.tsx.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { listProjectOptions } from '@/features/projects';
import type { SearchInput } from './api';
export type Draft = {
  query: string;
  archived: string;
  versions: string;
  format: string;
  project: string;
  period: string;
};
export function payload(d: Draft): SearchInput {
  return {
    query: d.query.trim(),
    options: {
      include_archived: d.archived === 'yes',
      previous_versions: d.versions === 'all',
      source_project: d.project === 'all' ? null : d.project,
      format: d.format === 'all' ? null : d.format,
      since: d.period === 'all' ? null : Date.now() - Number(d.period) * 86400000,
    },
  };
}
export function SearchForm({
  project,
  disabled,
  busy,
  onSearch,
}: {
  project: string;
  disabled: boolean;
  busy: boolean;
  onSearch: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    query: '',
    archived: 'yes',
    versions: 'latest',
    format: 'all',
    project: 'all',
    period: 'all',
  });
  const projects = useQuery({
    queryKey: ['projects', 'relation-options'],
    queryFn: ({ signal }) => listProjectOptions(signal),
  });
  function field(key: Exclude<keyof Draft, 'query'>, label: string, choices: [string, string][]) {
    return (
      <div>
        <Label htmlFor={`related-${key}`}>{label}</Label>
        <Select
          value={draft[key]}
          onValueChange={(v) => setDraft({ ...draft, [key]: v })}
          disabled={disabled}
        >
          <SelectTrigger id={`related-${key}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map(([v, name]) => (
              <SelectItem key={v} value={v}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  return (
    <form
      className="related-search-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(draft);
      }}
    >
      <Label htmlFor="related-query">
        추가로 찾을 주제 <span className="muted">(선택)</span>
      </Label>
      <div className="related-search-input">
        <Input
          id="related-query"
          value={draft.query}
          maxLength={120}
          disabled={disabled}
          placeholder="예: 운영 개선 사례, 실행 계획, 성과 지표"
          onChange={(e) => setDraft({ ...draft, query: e.target.value })}
        />
        <Button type="submit" disabled={disabled}>
          <Search aria-hidden="true" />
          {busy ? '찾는 중…' : '관련 자료 찾기'}
        </Button>
      </div>
      <p className="field-hint">
        현재 원본과 작성 방향의 일부 내용을 기준으로 과거 자료를 비교합니다. 검색어와 최근 업무
        자료에서 후보를 찾고 부족한 문맥은 추가로 확인합니다. 조사 범위에 한도가 있으며 모든 문서를
        한 번에 비교하지는 않습니다.
      </p>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost">
            <SlidersHorizontal aria-hidden="true" />
            검색 범위
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="related-filters">
          {field('archived', '프로젝트 상태', [
            ['yes', '보관 프로젝트 포함'],
            ['no', '진행 중인 프로젝트만'],
          ])}
          {field('versions', '문서 버전', [
            ['latest', '최신 파일 버전'],
            ['all', '이전 버전도 포함'],
          ])}
          {field('format', '파일 형식', [
            ['all', '모든 형식'],
            ...['pdf', 'hwp', 'hwpx', 'docx', 'pptx', 'xlsx', 'html', 'md'].map(
              (v) => [v, v.toUpperCase()] as [string, string],
            ),
          ])}
          {field('period', '등록 시기', [
            ['all', '전체 기간'],
            ['30', '최근 30일'],
            ['365', '최근 1년'],
          ])}
          {field('project', '프로젝트', [
            ['all', '모든 다른 프로젝트'],
            ...(projects.data?.items
              .filter((p) => p.id !== project)
              .map((p) => [p.id, p.name] as [string, string]) ?? []),
          ])}
          <p className="field-hint">
            선택 목록에는 최근 프로젝트 100개까지 표시합니다. ‘모든 다른 프로젝트’는 전체 범위를
            검색합니다.
          </p>
          {projects.isError && (
            <Button variant="secondary" onClick={() => void projects.refetch()}>
              프로젝트 목록 다시 불러오기
            </Button>
          )}
        </CollapsibleContent>
      </Collapsible>
    </form>
  );
}
