// Purpose: Start an actual template-based blank deck without analysis inputs or an AI connection.
// Pattern: Server-owned layout catalog, lazy immutable template preview and idempotent submission.
// Usage: Studio generation's manual tab; source/evidence completion is never fabricated.
// Related: canvas-api.ts, generation.tsx, features/document-processing/.
import { useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { FilePlus2 } from 'lucide-react';
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
import { listAssets } from '@/features/space';
import { getDetail, fileUrl } from '@/features/document-processing';
import { errorMessage } from '@/shared/api/http';
import { createBlank, getLayouts, canvasKeys } from './canvas-api';
import type { Run } from './api';
export function BlankForm({
  project,
  name,
  template,
  editable,
  active,
  busy,
  onCreated,
}: {
  project: string;
  name: string;
  template: string | null;
  editable: boolean;
  active: boolean;
  busy: boolean;
  onCreated: (r: Run) => void;
}) {
  const [title, setTitle] = useState(name),
    [asset, setAsset] = useState('selected'),
    [layout, setLayout] = useState(''),
    [offset, setOffset] = useState(0);
  const receipt = useRef<{ stamp: string; key: string } | null>(null);
  const assets = useQuery({
    queryKey: ['space', 'blank-templates', offset],
    queryFn: ({ signal }) => listAssets('templates', '', 'active', offset, signal),
    enabled: active,
  });
  const item = assets.data?.items.find((a) => a.id === asset);
  const detail = useQuery({
    queryKey: ['processing', 'blank-template', item?.id, item?.file_version],
    queryFn: ({ signal }) => getDetail('templates', item?.id ?? '', undefined, signal),
    enabled: active && !!item && item.processing === 'succeeded',
  });
  const job =
    asset === 'selected' ? template : asset === 'builtin' ? null : (detail.data?.job.id ?? null);
  const waiting =
    asset !== 'builtin' && asset !== 'selected' && detail.data?.job.status !== 'succeeded';
  const layouts = useQuery({
    queryKey: canvasKeys.layouts(project, job),
    queryFn: ({ signal }) => getLayouts(project, job, signal),
    enabled: active && !waiting,
    staleTime: 60000,
  });
  const chosen = layouts.data?.find((l) => l.key === layout)?.key ?? layouts.data?.[0]?.key ?? '';
  const create = useMutation({
    mutationFn: () => {
      const input = { title, template_job_id: job, layout_key: chosen },
        stamp = JSON.stringify(input);
      if (receipt.current?.stamp !== stamp) receipt.current = { stamp, key: crypto.randomUUID() };
      return createBlank(project, receipt.current.key, input);
    },
    retry: false,
    onSuccess: (r) => {
      receipt.current = null;
      onCreated(r);
    },
  });
  const thumb = detail.data?.template?.previews.find(
    (p) => p.ordinal === layouts.data?.find((l) => l.key === chosen)?.preview_page,
  );
  return (
    <form
      className="presentation-form"
      aria-label="빈 장표 만들기"
      onSubmit={(e) => {
        e.preventDefault();
        if (chosen && !waiting) create.mutate();
      }}
    >
      <p className="muted">
        선택한 디자인의 배경과 배치를 사용해 직접 작성합니다. AI 연결 없이 시작할 수 있습니다.
      </p>
      <div>
        <Label htmlFor="blank-title">발표자료 제목</Label>
        <Input
          id="blank-title"
          value={title}
          required
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="blank-template">템플릿</Label>
        <Select
          value={asset}
          onValueChange={(v) => {
            setAsset(v);
            setLayout('');
          }}
        >
          <SelectTrigger id="blank-template">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="selected">
              {template ? '앞에서 선택한 템플릿' : '기본 디자인'}
            </SelectItem>
            {template && <SelectItem value="builtin">기본 디자인</SelectItem>}
            {assets.data?.items.map((a) => (
              <SelectItem key={a.id} value={a.id} disabled={a.processing !== 'succeeded'}>
                {a.title}
                {a.processing !== 'succeeded' ? ' · 준비 중' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!!assets.data && assets.data.total > 12 && (
        <div className="related-pagination">
          <Button
            type="button"
            variant="ghost"
            disabled={!offset}
            onClick={() => {
              setOffset(offset - 12);
              setAsset('selected');
            }}
          >
            이전 템플릿
          </Button>
          <span>
            {offset / 12 + 1} / {Math.ceil(assets.data.total / 12)}
          </span>
          <Button
            type="button"
            variant="ghost"
            disabled={offset + 12 >= assets.data.total}
            onClick={() => {
              setOffset(offset + 12);
              setAsset('selected');
            }}
          >
            다음 템플릿
          </Button>
        </div>
      )}
      <div>
        <Label htmlFor="blank-layout">장표 배치</Label>
        <Select value={chosen} onValueChange={setLayout} disabled={waiting || layouts.isPending}>
          <SelectTrigger id="blank-layout">
            <SelectValue placeholder="배치를 불러옵니다" />
          </SelectTrigger>
          <SelectContent>
            {layouts.data?.map((l) => (
              <SelectItem key={l.key} value={l.key}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {thumb && job && (
        <img
          className="blank-template-preview"
          src={fileUrl(job, thumb.sha256)}
          alt="선택한 배치를 사용하는 템플릿 예시 · 내용은 비워서 시작합니다"
          loading="lazy"
        />
      )}
      {(waiting || layouts.isPending) && <p role="status">선택한 템플릿을 확인하고 있습니다.</p>}
      {[
        { key: 'assets', query: assets },
        { key: 'detail', query: detail },
        { key: 'layouts', query: layouts },
      ]
        .filter(({ query }) => query.isError)
        .map(({ query: q, key }) => (
          <p key={key} role="alert">
            {errorMessage(q.error)}{' '}
            <Button type="button" variant="ghost" onClick={() => void q.refetch()}>
              다시 확인
            </Button>
          </p>
        ))}
      {create.isError && <p role="alert">{errorMessage(create.error)}</p>}
      <Button
        type="submit"
        disabled={!editable || busy || create.isPending || waiting || !chosen || layouts.isError}
      >
        <FilePlus2 aria-hidden="true" />
        {create.isPending ? '요청 중…' : '빈 장표로 시작'}
      </Button>
    </form>
  );
}
