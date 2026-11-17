// Purpose: Accept real local model authoring against explicitly selected public PDF/PPTX inputs.
// Pattern: Isolated product APIs and browser, real rendering, immutable outputs and opt-in model use.
// Usage: PREM_LIVE_LLM_URL/MODEL, PREM_LIVE_PDF/TEMPLATE node tests/e2e/presentation-live.cjs.
// Related: provider-live.cjs, server.cjs, presentation-live-inspect.py, tests/.artifacts/.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const { createServer } = require('./server.cjs');
const { json } = require('./outline-fixture.cjs');
const { upload } = require('./related-fixture.cjs');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
async function poll(read, done, label) {
  const end = Date.now() + 900000;
  while (Date.now() < end) {
    const value = await read();
    if (done(value)) return value;
    await delay(500);
  }
  throw Error(`Timed out: ${label}`);
}
(async () => {
  const endpoint = process.env.PREM_LIVE_LLM_URL,
    model = process.env.PREM_LIVE_LLM_MODEL;
  assert(endpoint && model && process.env.PREM_LIVE_PDF && process.env.PREM_LIVE_TEMPLATE);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname));
  const output = path.join(projectRoot, 'tests/.artifacts/presentation-live');
  const maxTokens = Number(process.env.PREM_LIVE_MAX_TOKENS ?? 30000);
  assert(Number.isSafeInteger(maxTokens) && maxTokens >= 256 && maxTokens <= 65536);
  await fs.mkdir(output, { recursive: true });
  const server = await createServer('presentation-live-');
  const observer = await require('./live-model-observer.cjs')(
    endpoint,
    path.join(output, 'model-responses.json'),
  );
  let browser;
  const report = { model, max_output_tokens: maxTokens, inputs: [], stages: [], runs: [] };
  async function stage(name, data = {}) {
    report.stages.push({ name, ...data });
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(name, JSON.stringify(data));
  }
  try {
    const pdf = await fs.readFile(process.env.PREM_LIVE_PDF),
      template = await fs.readFile(process.env.PREM_LIVE_TEMPLATE);
    assert(
      pdf.subarray(0, 5).toString() === '%PDF-' && template.subarray(0, 2).toString() === 'PK',
    );
    report.inputs = [pdf, template].map((b) => ({
      sha256: createHash('sha256').update(b).digest('hex'),
      bytes: b.length,
    }));
    const inventory = await globalThis.fetch(new URL('/api/v1/models', endpoint), {
      signal: AbortSignal.timeout(5000),
    });
    assert(inventory.ok);
    const loaded = (await inventory.json()).models.find(
      (m) => m.key === model || m.loaded_instances?.some((i) => i.id === model),
    );
    const contextLength = loaded?.loaded_instances?.[0]?.config?.context_length;
    assert(
      contextLength > maxTokens,
      'Load the selected model with enough context before acceptance',
    );
    report.model_context_length = contextLength;
    await server.start();
    const home = await globalThis.fetch(server.base + '/home/');
    assert(
      (await home.text()).includes('id="root"'),
      'Use pnpm build to include the production UI before live acceptance',
    );
    const base = server.base,
      connection = randomUUID();
    const config = await json(base, `/api/v1/admin/llm/providers/${connection}`, 'PUT', {
      expected_version: 0,
      name: '공개 자료 실모델 검증',
      provider_type: 'lm_studio',
      base_url: observer.base,
      model_identifier: model,
      timeout_seconds: 600,
      max_output_tokens: maxTokens,
      enabled: true,
    });
    assert.equal(config.max_output_tokens, maxTokens);
    const p = (
        await json(base, '/api/v1/projects', 'POST', {
          name: '공개 자료로 검증하는 접근성 업무 발표',
          due_date: '2030-01-01',
        })
      ).id,
      root = `/api/v1/projects/${p}`;
    const source = await upload(base, p, 'w3c-accessibility.pdf', pdf);
    const extracted = await poll(
      () => json(base, `${root}/files/${source.id}/processing`),
      (d) => {
        assert.notEqual(d.job.status, 'failed', JSON.stringify(d.job));
        return !!d.job.extraction_id;
      },
      'PDF extraction',
    );
    await fs.writeFile(path.join(output, 'source.json'), JSON.stringify(extracted, null, 2));
    await stage('PDF extracted', {
      pages: extracted.pages.length,
      blocks: extracted.job.total_blocks,
    });
    const sources = await require('./presentation-live-sources.cjs')(
      base,
      pdf,
      extracted.job.extraction_id,
    );
    await fs.writeFile(path.join(output, 'search.json'), JSON.stringify(sources, null, 2));
    await stage('Public reference search ready', {
      content_matches: sources.content_matches,
      file_matches: sources.file_matches,
    });
    const review = await json(base, root + '/source-review');
    assert(review.ready);
    await json(base, root + '/source-review', 'PUT', { snapshot: review.snapshot });
    await json(base, root + '/guide', 'PUT', {
      expected_version: 0,
      do_text:
        '일반 사무직의 웹 접근성 업무 교육입니다. 한국어로 대목차 하나와 그 아래 중목차 정확히 두 개만 작성하세요. 중목차는 접근성의 목적, 실무 적용으로 구성하고 실제 원문 블록을 연결하세요. 장표 본문은 짧은 두 문장으로 쓰세요.',
      dont_text:
        '외부 사실이나 수치, 최신 표준인 것처럼 주장하지 마세요. 오래된 공개 문서의 예시임을 밝히세요. URL과 저작권·목차만으로 장표를 만들지 마세요.',
    });
    const empty = await json(base, root + '/outline');
    await json(base, root + '/outline/runs', 'POST', {
      expected_version: 0,
      source_snapshot: empty.source_snapshot,
      guide_version: 1,
      connection_id: connection,
      model_version: 1,
      kind: 'generate',
      node_ids: [],
    });
    const outline = await poll(
      () => json(base, root + '/outline'),
      (s) => {
        assert.notEqual(s.run?.status, 'failed', JSON.stringify(s.run));
        return s.run?.status === 'succeeded';
      },
      'real model outline',
    );
    await fs.writeFile(path.join(output, 'outline.json'), JSON.stringify(outline, null, 2));
    await stage('Model outline ready', {
      nodes: outline.draft.nodes.length,
      assignments: outline.draft.assignments.length,
    });
    await json(base, root + '/outline/confirm', 'POST', { expected_version: outline.version });
    const preparation = await json(base, root + '/presentation-preparation');
    const evidence = await json(base, root + '/presentation-preparation/evidence', 'POST', {
      fingerprint: preparation.fingerprint,
    });
    const form = new FormData();
    form.set('file', new Blob([template]), 'w3c-2025-template.pptx');
    form.set('title', 'W3C 공개 템플릿');
    form.set('tags', '[]');
    const response = await fetch(base + '/api/v1/space/templates', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: form,
    });
    const asset = await response.json();
    assert.equal(response.status, 201, JSON.stringify(asset));
    const detail = await poll(
      () => json(base, `/api/v1/space/templates/${asset.id}/processing`),
      (d) => {
        assert.notEqual(d.job.status, 'failed', JSON.stringify(d.job));
        return d.job.status === 'succeeded';
      },
      'public template extraction',
    );
    await fs.writeFile(path.join(output, 'template.json'), JSON.stringify(detail, null, 2));
    await stage('Public template ready', { pages: detail.template.previews.length });
    let current, slides;
    const modes =
      process.env.PREM_LIVE_TEMPLATE_ONLY === '1'
        ? [['template', detail.job.id]]
        : [
            ['basic', null],
            ['template', detail.job.id],
          ];
    for (const [label, templateJob] of modes) {
      const pre = await json(base, root + '/presentation-preparation');
      const design = await json(base, root + '/presentation-preparation/design', 'PUT', {
        expected_version: pre.version,
        evidence_review_id: evidence.evidence_review_id,
        template_job_id: templateJob,
      });
      await json(base, root + '/presentations', 'POST', {
        design_id: design.design_id,
        title: '웹 접근성 업무 교육',
        instructions:
          '공개 원문에 근거해 간결한 한국어로 작성하세요. 본문은 두 문장, 각 45자 이하입니다.',
        connection_id: connection,
        model_version: 1,
        presentation_id: current?.presentation_id ?? null,
        expected_version: current?.presentation_version ?? 0,
      });
      const previous = current?.id;
      current = (
        await poll(
          () => json(base, root + '/presentations'),
          (rows) => {
            if (rows[0]?.id === previous) return false;
            assert.notEqual(rows[0]?.status, 'failed', JSON.stringify(rows[0]));
            return rows[0]?.status === 'succeeded';
          },
          `${label} real model generation`,
        )
      )[0];
      slides = await json(base, `${root}/presentations/${current.id}/slides`);
      assert(slides.length >= 1 && slides.length <= 3);
      assert.equal(
        new Set(slides.map((s) => s.spec.title)).size,
        slides.length,
        'Distinct outline topics must not repeat the deck title on every slide',
      );
      for (const slide of slides) {
        assert(slide.spec.block_ids.length > 0);
        if (templateJob) assert.equal(slide.spec.design.authored, false);
      }
      assert(current.quality.every((q) => q.report.passed));
      for (const [index, slide] of slides.entries()) {
        const preview = await fetch(
          base + `${root}/presentations/${current.id}/slides/${slide.id}/preview`,
        );
        assert(preview.ok && preview.headers.get('content-type')?.startsWith('image/png'));
        await fs.writeFile(
          path.join(
            projectRoot,
            `tests/.artifacts/captures/folio/ornith-public-${label}-${index + 1}.png`,
          ),
          Buffer.from(await preview.arrayBuffer()),
        );
      }
      const result = await fetch(base + `${root}/presentations/${current.id}/download`);
      assert(result.ok);
      await fs.writeFile(
        path.join(output, `${label}.pptx`),
        Buffer.from(await result.arrayBuffer()),
      );
      await fs.writeFile(
        path.join(output, `${label}-slides.json`),
        JSON.stringify(slides, null, 2),
      );
      report.runs.push(current);
      await stage(`${label} PPTX ready`, { slides: slides.length, quality: current.quality });
    }
    browser = await openBrowser('presentation-live');
    const page = await (await browser.browser.createBrowserContext()).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1100 });
    const route = base + `/home/studio/${p}?step=generation`;
    await page.goto(route, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.presentation-output', { visible: true, timeout: 60000 });
    await page.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    await page.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/ornith-public-template.png'),
    });
    await page
      .locator('#slide-edit-prompt')
      .fill(
        '제목만 정확히 "접근성 실무 안내"로 바꾸세요. 본문, 메모, 배치와 모든 객체는 유지하세요.',
      );
    await (await page.waitForSelector('::-p-aria(수정 요청 보내기[role="button"])')).click();
    const thread = `${root}/presentations/${current.id}/slides/${slides[0].id}/edits`;
    const edit = (
      await poll(
        () => json(base, thread),
        (rows) => {
          assert.notEqual(rows.at(-1)?.status, 'failed', JSON.stringify(rows.at(-1)));
          return rows.at(-1)?.status === 'ready';
        },
        'real model edit',
      )
    ).at(-1);
    assert.equal(edit.proposal.title, '접근성 실무 안내');
    assert.deepEqual(edit.before.bullets, edit.proposal.bullets);
    assert.deepEqual(edit.before.objects, edit.proposal.objects);
    await fs.writeFile(path.join(output, 'edit.json'), JSON.stringify(edit, null, 2));
    await json(base, `${root}/slide-edits/${edit.id}/apply`, 'POST', {
      expected_version: edit.version,
    });
    const edited = (
      await poll(
        () => json(base, root + '/presentations'),
        (rows) => {
          if (rows[0]?.id === current.id) return false;
          assert.notEqual(rows[0]?.status, 'failed', JSON.stringify(rows[0]));
          return rows[0]?.status === 'succeeded';
        },
        'edited PPTX',
      )
    )[0];
    const result = await fetch(base + `${root}/presentations/${edited.id}/download`);
    assert(result.ok);
    await fs.writeFile(path.join(output, 'edited.pptx'), Buffer.from(await result.arrayBuffer()));
    assert.deepEqual(await json(base, `${root}/presentations/${current.id}/slides`), slides);
    const shared = await (await browser.browser.createBrowserContext()).newPage();
    await shared.goto(route, { waitUntil: 'networkidle0' });
    await shared.waitForSelector('.presentation-output', { visible: true });
    await shared.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    await shared.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/ornith-public-edited.png'),
    });
    assert.deepEqual(errors, []);
    await server.stop();
    await server.start();
    const restarted = await json(base, root + '/presentations');
    assert.equal(restarted[0].id, edited.id);
    assert.equal(restarted[0].status, 'succeeded');
    const requests = JSON.parse(
      await fs.readFile(path.join(output, 'model-responses.json'), 'utf8'),
    );
    assert(requests.length >= (modes.length === 1 ? 4 : 6));
    assert(requests.every((r) => r.max_tokens === maxTokens && r.finish_reason === 'stop'));
    await stage(
      `PASS: real model PDF → outline → ${modes.map(([name]) => name).join('/')} PPTX → reviewed chat → shared/restart`,
      { edited: edited.id },
    );
  } catch (e) {
    await stage('FAILED', { message: e.message });
    throw e;
  } finally {
    const cleanup = await Promise.allSettled([browser?.close(), server.close(), observer.close()]);
    for (const result of cleanup)
      if (result.status === 'rejected') console.error('QA cleanup failed:', result.reason);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
