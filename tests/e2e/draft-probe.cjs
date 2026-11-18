// Purpose: Exercise the save gate in the browser and answer diagnostic samples on fixture servers.
// Pattern: Synthetic responses are restricted to the probe prompt or fixed diagnostic question.
// Usage: Feature journeys still send the actual HTTP diagnosis before saving a connection.
// Related: admin-client.cjs, providers.cjs, provider_drafts.rs.
async function verifyDraft(page) {
  await page.click('.provider-form .provider-actions button');
  await page.waitForFunction(() =>
    document
      .querySelector('.provider-form .provider-actions [role=status]')
      ?.textContent.includes('통과'),
  );
}
function replyToProbe(res, body) {
  if (
    body.messages?.[0]?.content ===
    'This is a connectivity diagnostic. Return the requested final text.'
  ) {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: 'PreM connection OK' } }],
      }),
    );
    return true;
  }
  if (body.questions?.category && body.state === '목차\n1. 개요\n2. 계획') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        model: body.model,
        answers: {
          category: {
            type: 'choice',
            choice: '1',
            confidence: 0.9,
            probabilities: { 0: 0.1, 1: 0.9 },
          },
        },
      }),
    );
    return true;
  }
  return false;
}
module.exports = { verifyDraft, replyToProbe };
