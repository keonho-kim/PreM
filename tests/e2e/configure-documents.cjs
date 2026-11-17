// Purpose: Satisfy the real document model gate with a local deterministic classification fixture.
// Pattern: Explicit Admin setup in isolated test storage; callers own fixture shutdown.
// Usage: Browser/parser journeys that test extraction rather than model selection.
// Related: outline-fixture.cjs, admin-client.cjs, document-processing.cjs.
const { randomUUID } = require('node:crypto');
const { model, json } = require('./outline-fixture.cjs');
async function configureDocuments(base) {
  const fixture = await model();
  try {
    const id = randomUUID();
    await json(base, `/api/v1/admin/llm/providers/${id}`, 'PUT', {
      expected_version: 0,
      name: '문서 검증 모델',
      provider_type: 'openai_compatible',
      base_url: fixture.base,
      model_identifier: 'fixture',
      timeout_seconds: 30,
      enabled: true,
    });
    await json(base, '/api/v1/admin/document-processing/settings', 'PUT', {
      expected_version: 0,
      connection_id: id,
    });
    return fixture;
  } catch (error) {
    await fixture.close();
    throw error;
  }
}
module.exports = { configureDocuments };
