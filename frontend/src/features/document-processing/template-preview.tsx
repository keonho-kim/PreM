// Purpose: Let people inspect extracted template slides without internal analysis metadata.
// Pattern: One selected paper preview and an accessible lazy thumbnail gallery.
// Usage: Space asset dialog receives previews pinned to the selected source version.
// Related: api.ts, processing.css, backend/tools/template-previews.mjs.
import { useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fileUrl, type Detail } from './api';
function SlideImage({
  src,
  ordinal,
  width,
  height,
  thumbnail = false,
}: {
  src: string;
  ordinal: number;
  width: number;
  height: number;
  thumbnail?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <span className="template-image-error">
        <ImageOff aria-hidden="true" />
        이미지를 불러올 수 없습니다.
      </span>
    );
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Image load failure is a resource event, not an interactive action.
    <img
      src={src}
      alt={thumbnail ? '' : `슬라이드 ${ordinal} 미리보기`}
      width={width}
      height={height}
      loading={thumbnail ? 'lazy' : 'eager'}
      fetchPriority={thumbnail ? undefined : 'high'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
export function TemplatePreview({ detail }: { detail: Detail }) {
  const [selected, setSelected] = useState(0);
  const slides = detail.template?.previews ?? [];
  const slide = slides[selected];
  if (!slide)
    return (
      <p className="template-empty">
        아직 미리보기가 없습니다. 원본 파일을 내려받아 확인할 수 있습니다.
      </p>
    );
  return (
    <section className="template-preview" aria-label="템플릿 미리보기">
      <div
        className="template-preview-paper"
        style={{ aspectRatio: `${slide.width} / ${slide.height}` }}
      >
        <SlideImage key={slide.sha256} src={fileUrl(detail.job.id, slide.sha256)} {...slide} />
      </div>
      <div className="template-preview-navigation">
        <Button
          variant="ghost"
          size="icon"
          aria-label="이전 슬라이드"
          disabled={selected === 0}
          onClick={() => setSelected(selected - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <p role="status">
          {selected + 1} / {slides.length}
        </p>
        <Button
          variant="ghost"
          size="icon"
          aria-label="다음 슬라이드"
          disabled={selected === slides.length - 1}
          onClick={() => setSelected(selected + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <fieldset className="template-preview-thumbnails">
        <legend className="sr-only">슬라이드 목록</legend>
        {slides.map((item, index) => (
          <Button
            key={item.ordinal}
            variant="ghost"
            className="template-thumbnail"
            aria-label={`슬라이드 ${item.ordinal} 보기`}
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
          >
            <span
              className="template-thumbnail-image"
              style={{ aspectRatio: `${item.width} / ${item.height}` }}
            >
              <SlideImage
                key={item.sha256}
                src={fileUrl(detail.job.id, item.sha256)}
                {...item}
                thumbnail
              />
            </span>
            <span>{item.ordinal}</span>
          </Button>
        ))}
      </fieldset>
    </section>
  );
}
