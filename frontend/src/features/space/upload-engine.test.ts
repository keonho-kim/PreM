// Purpose: Verify Uppy owns isolated file contexts and server-confirmed cancellation.
// Pattern: Real Uppy engine with transmission paused and controlled cancellation API responses.
// Usage: Vitest; real browser/server upload and retry are covered by Space E2E.
// Related: upload-engine.ts, api.ts, tests/e2e/space.cjs.
import { afterEach, expect, it, vi } from 'vitest';
import { createUploadEngine } from './upload-engine';
import type { InternalAxiosRequestConfig } from 'axios';
const transport = vi.hoisted(() => vi.fn());
vi.mock('axios', async (importOriginal) => {
  const { default: axios } = await importOriginal<typeof import('axios')>();
  return {
    default: {
      create: (options: Parameters<typeof axios.create>[0]) =>
        axios.create({ ...options, adapter: transport }),
    },
  };
});
const response = (data: unknown, status = 200) => ({ data, status });

afterEach(() => transport.mockReset());
it('pins library and retry keys per file and never persists selected file data', async () => {
  const saved = vi.fn(),
    engine = createUploadEngine(saved);
  engine.uppy.setOptions({ autoProceed: false });
  try {
    const file = new File(['original'], 'same.pptx', { type: 'application/octet-stream' });
    engine.add([file], 'references', '근거', ['팀']);
    engine.add([file], 'templates', '템플릿', []);
    const files = engine.uppy.getFiles();
    expect(files).toHaveLength(2);
    expect(files[0]?.meta.kind).toBe('references');
    expect(files[1]?.meta.kind).toBe('templates');
    expect(files[0]?.meta.requestKey).not.toBe(files[1]?.meta.requestKey);
    const first = files[0];
    if (!first) throw new Error('missing file');
    const key = first.meta.requestKey;
    transport.mockImplementation(async (init: InternalAxiosRequestConfig) => {
      expect(init.url).toBe(`/api/v1/space/uploads/${key}`);
      expect(init.method).toBe('delete');
      return response({ state: 'cancelled', item_id: null });
    });
    expect(await engine.cancel(first.id)).toBe('cancelled');
    expect(engine.uppy.getFiles()).toHaveLength(1);
    expect(saved).not.toHaveBeenCalled();
  } finally {
    engine.dispose();
  }
});
it('reports an already committed cancellation and rejects a non-PPTX template', async () => {
  const saved = vi.fn(),
    engine = createUploadEngine(saved);
  engine.uppy.setOptions({ autoProceed: false });
  try {
    expect(() => engine.add([new File(['pdf'], 'file.pdf')], 'templates', '', [])).toThrow('PPTX');
    engine.add([new File(['pdf'], 'file.pdf')], 'references', '', []);
    const file = engine.uppy.getFiles()[0];
    if (!file) throw new Error('missing file');
    transport.mockResolvedValue(response({ state: 'complete', item_id: 'stored' }));
    expect(await engine.cancel(file.id)).toBe('complete');
    expect(saved).toHaveBeenCalledOnce();
    expect(engine.uppy.getFiles()).toHaveLength(0);
  } finally {
    engine.dispose();
  }
});

it('accepts HTML aliases as references and keeps templates restricted to PPTX', () => {
  const engine = createUploadEngine(vi.fn());
  engine.uppy.setOptions({ autoProceed: false });
  try {
    const html = new File(['<p>문서</p>'], 'guide.HTML', { type: 'text/html' });
    const htm = new File(['<p>원본</p>'], 'guide.htm', { type: 'text/html' });
    engine.add([html, htm], 'references', '', []);
    expect(engine.uppy.getFiles()).toHaveLength(2);
    expect(() => engine.add([html], 'templates', '', [])).toThrow('PPTX');
    engine.add(
      [new File(['# 문서'], 'guide.md'), new File(['본문'], 'notes.MARKDOWN')],
      'references',
      '',
      [],
    );
    expect(engine.uppy.getFiles()).toHaveLength(4);
    expect(() => engine.add([new File(['# 문서'], 'guide.md')], 'templates', '', [])).toThrow(
      'PPTX',
    );
    expect(() =>
      engine.add(
        [new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.md')],
        'references',
        '',
        [],
      ),
    ).toThrow('2 MiB');
  } finally {
    engine.dispose();
  }
});
