// Purpose: Fetch two attributed public originals for opt-in local-model presentation acceptance.
// Pattern: Pinned source sizes/hashes and bounded HTTPS reads; no application storage mutations.
// Usage: node tests/helpers/presentation-public.mjs; downloads belong in tests/.artifacts/.
// Related: fixtures/presentation-public.json, e2e/presentation-live.cjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(
  await fs.readFile(path.join(root, 'tests/fixtures/presentation-public.json'), 'utf8'),
);
const output = path.join(root, 'tests/.artifacts/presentation-public');
await fs.mkdir(output, { recursive: true });
for (const item of manifest.files) {
  if (path.basename(item.name) !== item.name || new URL(item.url).origin !== 'https://www.w3.org')
    throw Error('Invalid public fixture');
  const response = await fetch(item.url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok || Number(response.headers.get('content-length')) > 4 * 1024 * 1024)
    throw Error(`Download rejected: ${item.name}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw Error('Public fixture limit');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (
    size !== item.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== item.sha256 ||
    !bytes.subarray(0, item.magic.length).equals(Buffer.from(item.magic))
  )
    throw Error(
      `Public source changed: ${item.name}; review its new original before updating the manifest`,
    );
  const target = path.join(output, item.name),
    temporary = `${target}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  console.log(`Verified ${item.name}: ${item.sha256}`);
}
await fs.writeFile(path.join(output, 'sources.json'), JSON.stringify(manifest, null, 2));
