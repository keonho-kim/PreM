// Purpose: Preview and insert immutable source slides/artwork from the shared reference library.
// Pattern: Separate preview/selection; server validates source IDs, current revision and idempotency.
// Usage: Editor Reference tab; selection queues a real new PPTX revision without an LLM call.
// Related: document-processing facade, materials-api.ts, native-reference tests.
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
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
import { listAssets } from '@/features/space';
import { getDetail, getMaterials, fileUrl } from '@/features/document-processing';
import { request, errorMessage } from '@/shared/api/http';
import { runSchema, type Run } from './api';
import './material-insertion.css';
const kinds: Record<string, string> = {
  slide: '장표 전체',
  page: '페이지 이미지',
  chart: '편집 가능한 차트',
  diagram: '도형·도식',
  image: '이미지',
  table: '표',
  text: '글',
};
export function MaterialInsertion({
  project,
  run,
  slide,
  editable,
  session,
  onResult,
}: {
  project: string;
  run: Run;
  slide: string;
  editable: boolean;
  session?: string | null;
  onResult?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(''),
    [query, setQuery] = useState(''),
    [asset, setAsset] = useState(''),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [preview, setPreview] = useState(''),
    [materialOffset, setMaterialOffset] = useState(0);
  const receipt = useRef<{ stamp: string; key: string } | null>(null),
    client = useQueryClient();
  const files = useQuery({
    queryKey: ['reference-picker', query, offset],
    queryFn: ({ signal }) => listAssets('references', query, 'active', offset, signal),
    enabled: open,
  });
  const detail = useQuery({
    queryKey: ['reference-picker', asset],
    queryFn: ({ signal }) => getDetail('references', asset, undefined, signal),
    enabled: open && !!asset,
  });
  const job = detail.data?.job?.id;
  const items = useQuery({
    queryKey: ['reference-picker', job, 'materials', materialOffset],
    queryFn: ({ signal }) => getMaterials(job ?? '', 'all', '', materialOffset, signal),
    enabled: open && !!job,
  });
  const insert = useMutation({
    mutationFn: async () => {
      if (!job || !selected.length) throw Error('넣을 자료를 선택하세요.');
      const body = {
        expected_version: run.presentation_version,
        slide_id: slide,
        session,
        items: selected.map((material_id) => ({ job_id: job, material_id })),
      };
      const stamp = JSON.stringify([run.id, body]);
      if (receipt.current?.stamp !== stamp) receipt.current = { stamp, key: crypto.randomUUID() };
      return request(`/api/v1/projects/${project}/presentations/${run.id}/materials`, runSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': receipt.current.key },
        body: JSON.stringify(body),
      });
    },
    retry: false,
    onSuccess: (result) => {
      setOpen(false);
      setSelected([]);
      receipt.current = null;
      void client.invalidateQueries({ queryKey: ['presentations'] });
      if (result) onResult?.(result.id);
    },
  });
  const error = files.error ?? detail.error ?? items.error ?? insert.error;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!insert.isPending) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" disabled={!editable}>
          <Plus aria-hidden="true" />
          레퍼런스 넣기
        </Button>
      </DialogTrigger>
      <DialogContent className="material-insertion">
        <header>
          <DialogTitle>발표자료에 넣을 레퍼런스</DialogTitle>
          <DialogDescription>
            장표·페이지는 현재 장표 뒤에 추가하고, 그림·차트·글은 현재 장표에 넣습니다. 원본과 이전
            발표자료는 보존됩니다.
          </DialogDescription>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(draft.trim());
            setOffset(0);
          }}
        >
          <Label htmlFor="reference-picker-search">자료 이름으로 찾기</Label>
          <div className="material-picker-search">
            <Input
              id="reference-picker-search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229))
                  e.preventDefault();
              }}
            />
            <Button type="submit" variant="secondary">
              찾기
            </Button>
          </div>
        </form>
        <Label htmlFor="reference-picker-file">레퍼런스 파일</Label>
        <Select
          value={asset}
          onValueChange={(id) => {
            setAsset(id);
            setMaterialOffset(0);
            setSelected([]);
            setPreview('');
          }}
        >
          <SelectTrigger id="reference-picker-file">
            <SelectValue placeholder="파일을 선택하세요" />
          </SelectTrigger>
          <SelectContent>
            {files.data?.items.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.title} · {item.filename}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!!files.data?.total && files.data.total > 12 && (
          <div>
            <Button
              variant="ghost"
              disabled={!offset}
              onClick={() => setOffset((v) => Math.max(0, v - 12))}
            >
              이전 파일
            </Button>
            <Button
              variant="ghost"
              disabled={offset + 12 >= files.data.total}
              onClick={() => setOffset((v) => v + 12)}
            >
              다음 파일
            </Button>
          </div>
        )}
        {error && (
          <p role="alert">
            {errorMessage(error)}{' '}
            <Button
              variant="ghost"
              onClick={() => {
                void files.refetch();
                if (asset) void detail.refetch();
                if (job) void items.refetch();
              }}
            >
              다시 확인
            </Button>
          </p>
        )}
        {(files.isPending || (asset && detail.isPending) || (job && items.isPending)) && (
          <p role="status">자료를 불러옵니다.</p>
        )}
        {files.data?.total === 0 && (
          <p>등록된 레퍼런스가 없습니다. Space에서 자료를 먼저 등록하세요.</p>
        )}
        {job && items.data?.items.length === 0 && (
          <p>아직 넣을 자료가 준비되지 않았습니다. 잠시 후 다시 확인하세요.</p>
        )}
        {preview && job && (
          <img
            className="material-picker-large"
            src={fileUrl(job, preview)}
            alt="선택한 자료 크게 보기"
          />
        )}
        <ul className="material-picker-grid">
          {items.data?.items.map((item) => (
            <li key={item.id} data-material-id={item.id}>
              {item.preview && job ? (
                <Button
                  variant="ghost"
                  className="material-picker-preview"
                  aria-label={`${item.title} 크게 보기`}
                  onClick={() => setPreview(item.preview ?? '')}
                >
                  <img src={fileUrl(job, item.preview)} alt={item.title} loading="lazy" />
                </Button>
              ) : (
                <FileText aria-hidden="true" />
              )}
              <strong>{item.title}</strong>
              <p className="field-hint">
                {kinds[item.kind]} · {item.page_label}
                {item.preview_scope === 'page' ? ' · 포함된 원본 페이지' : ''}
              </p>
              <Button
                variant="secondary"
                aria-pressed={selected.includes(item.id)}
                onClick={() =>
                  setSelected((ids) =>
                    ids.includes(item.id)
                      ? ids.filter((id) => id !== item.id)
                      : ids.length < 10
                        ? [...ids, item.id]
                        : ids,
                  )
                }
              >
                {selected.includes(item.id) ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Plus aria-hidden="true" />
                )}
                {selected.includes(item.id) ? '선택됨' : '선택'}
              </Button>
            </li>
          ))}
        </ul>
        {!!items.data?.total && items.data.total > 20 && (
          <div>
            <Button
              variant="ghost"
              disabled={!materialOffset}
              onClick={() => setMaterialOffset((v) => Math.max(0, v - 20))}
            >
              이전 자료
            </Button>
            <span>
              {materialOffset + 1}–{Math.min(materialOffset + 20, items.data.total)} /{' '}
              {items.data.total}
            </span>
            <Button
              variant="ghost"
              disabled={materialOffset + 20 >= items.data.total}
              onClick={() => setMaterialOffset((v) => v + 20)}
            >
              다음 자료
            </Button>
          </div>
        )}
        <p className="field-hint">
          최대 10개를 선택할 수 있습니다. PPTX 장표·차트·도형은 원본 객체로, PDF 페이지는 이미지로
          삽입합니다.
        </p>
        <Button
          disabled={!selected.length || insert.isPending || !editable}
          onClick={() => insert.mutate()}
        >
          {insert.isPending ? '발표자료 준비 중…' : `선택한 자료 ${selected.length}개 넣기`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
