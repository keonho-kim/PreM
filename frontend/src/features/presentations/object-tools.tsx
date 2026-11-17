// Purpose: Select slide objects and prepare explicit image/chart/layout editing requests.
// Pattern: Native previews and shadcn controls; uploading media never changes a slide by itself.
// Usage: Right inspector Object tab; chat owns sending and proposal approval.
// Related: media-api.ts, object-selection.tsx, slide-chat.tsx.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/shared/api/http';
import { listMedia, mediaKey, mediaUrl, uploadImage } from './media-api';
import type { Slide } from './api';
export function ObjectTools({
  project,
  slide,
  active,
  editable,
  selected,
  onSelect,
  onAsk,
}: {
  project: string;
  slide: Slide;
  active: boolean;
  editable: boolean;
  selected: string[];
  onSelect: (id: string, multiple: boolean) => void;
  onAsk: (prompt: string, keepSelection?: boolean) => void;
}) {
  const images = useQuery({
    queryKey: mediaKey(project),
    queryFn: ({ signal }) => listMedia(project, signal),
    enabled: active,
  });
  const client = useQueryClient(),
    controller = useRef<AbortController | null>(null),
    receipt = useRef<{ file: File; key: string } | null>(null);
  const [file, setFile] = useState<File | null>(null),
    [localError, setLocalError] = useState(''),
    [chart, setChart] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  const upload = useMutation({
    mutationFn: async () => {
      if (!file || file.size > 5 * 1024 * 1024) throw Error('image_limit');
      if (receipt.current?.file !== file) receipt.current = { file, key: crypto.randomUUID() };
      controller.current = new AbortController();
      return uploadImage(project, receipt.current.key, file, controller.current.signal);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: mediaKey(project) });
      setFile(null);
      receipt.current = null;
    },
  });
  return (
    <section className="slide-object-tools" aria-label="슬라이드 객체">
      <h3>이 장표의 객체</h3>
      <p className="field-hint">
        선택한 객체만 대화로 수정합니다. Ctrl 또는 ⌘ 클릭으로 여러 개를 선택하세요.
      </p>
      <div className="slide-object-list">
        {slide.spec?.objects?.map((o) => (
          <Button
            key={o.id}
            variant="ghost"
            aria-pressed={selected.includes(o.id)}
            onClick={(e) => onSelect(o.id, e.ctrlKey || e.metaKey)}
          >
            {o.name}
            <span>
              {
                {
                  reference: '참고 자료',
                  image: '이미지',
                  chart: '차트',
                  shape: '도형',
                  text: '텍스트',
                }[o.content.kind]
              }
            </span>
          </Button>
        ))}
      </div>
      {!slide.spec?.objects?.length && <p className="field-hint">추가된 객체가 없습니다.</p>}
      {selected.length > 0 && (
        <Button variant="ghost" onClick={() => onSelect('', false)}>
          객체 선택 해제
        </Button>
      )}
      {selected.length > 0 && (
        <Button disabled={!editable} onClick={() => onAsk('선택한 객체를 ', true)}>
          선택한 {selected.length}개 수정 요청
        </Button>
      )}
      <Button
        variant="secondary"
        disabled={!editable}
        onClick={() => onAsk('제목과 본문 위치를 다음과 같이 조정해 주세요: ')}
      >
        제목·본문 배치 수정
      </Button>
      <form
        aria-label="장표 이미지 등록"
        onSubmit={(e) => {
          e.preventDefault();
          setLocalError('');
          if (!file || file.size > 5 * 1024 * 1024) {
            setLocalError('5 MiB 이하의 PNG, JPEG, WebP 이미지를 선택하세요.');
            return;
          }
          upload.mutate();
        }}
      >
        <Label htmlFor="slide-image-file">사용할 이미지</Label>
        <Input
          id="slide-image-file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={upload.isPending || !editable}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="field-hint">
          PNG·JPEG·WebP · 최대 5 MiB, 1,600만 화소. 등록 후 삽입을 요청하세요.
        </p>
        <Button type="submit" disabled={!editable || upload.isPending}>
          {upload.isPending ? '이미지 등록 중…' : '이미지 등록'}
        </Button>
        {upload.isPending && (
          <Button variant="ghost" onClick={() => controller.current?.abort()}>
            취소
          </Button>
        )}
        {localError && <p role="alert">{localError}</p>}
        {upload.isError && <p role="alert">{errorMessage(upload.error)}</p>}
      </form>
      {images.isError && (
        <p role="alert">
          {errorMessage(images.error)}{' '}
          <Button variant="ghost" onClick={() => void images.refetch()}>
            다시 확인
          </Button>
        </p>
      )}
      <div className="slide-media-gallery">
        {images.data?.map((m) => (
          <Button
            key={m.id}
            variant="ghost"
            disabled={!editable}
            aria-label={`${m.name} 삽입 요청`}
            onClick={() =>
              onAsk(`이미지 "${m.name}" 를 장표 오른쪽에 넣고 본문과 겹치지 않게 배치해 주세요.`)
            }
          >
            <img loading="lazy" src={mediaUrl(project, m.id)} alt="" />
            <span>{m.name}</span>
          </Button>
        ))}
      </div>
      <form
        aria-label="차트 만들기 요청"
        onSubmit={(e) => {
          e.preventDefault();
          if (chart.trim())
            onAsk(
              `다음 실제 데이터를 사용해 편집 가능한 차트를 만들고 본문과 겹치지 않게 배치해 주세요. 수치를 만들지 마세요.\n${chart}`,
            );
        }}
      >
        <Label htmlFor="slide-chart-data">차트에 사용할 데이터</Label>
        <Textarea
          id="slide-chart-data"
          value={chart}
          onChange={(e) => setChart(e.target.value)}
          placeholder="항목과 수치, 단위, 원하는 차트 형태를 입력하세요"
          maxLength={1500}
          required
          disabled={!editable}
        />
        <p className="field-hint">
          막대·가로 막대·꺾은선·원형 차트를 지원합니다. 수정안을 확인한 뒤 적용합니다.
        </p>
        <Button type="submit" disabled={!editable}>
          차트 요청 작성
        </Button>
      </form>
      <Button
        variant="ghost"
        disabled={!editable}
        onClick={() => onAsk('강조할 내용을 담은 사각형과 텍스트 상자를 추가해 주세요: ')}
      >
        도형·텍스트 추가 요청
      </Button>
    </section>
  );
}
