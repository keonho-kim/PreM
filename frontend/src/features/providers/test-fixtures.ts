// Purpose: Supply small synthetic provider catalog responses for feature tests.
// Pattern: Explicit test data; production identities and capabilities come from the server.
// Usage: Vitest only, never imported by product components.
// Related: provider-dialog.test.tsx, pages/admin-page.test.tsx, provider-types.ts.
import type { ProviderOption } from './provider-types';
export const catalogFixture: ProviderOption[] = [
  {
    category: 'llm',
    id: 'lm_studio_native',
    label: 'LM Studio Native',
    protocol: 'Native Chat',
    base: 'http://localhost:1234/api/v1',
    model: 'ornith-1.5-35b-a3b',
    structured: false,
    key: false,
    structured_reason: '구조화 출력 미지원',
  },
  {
    category: 'llm',
    id: 'lm_studio',
    label: 'LM Studio · OpenAI 호환',
    protocol: 'Chat Completions',
    base: 'http://localhost:1234/v1',
    model: 'ornith-1.5-35b-a3b',
    structured: true,
    key: false,
    structured_reason: null,
  },
  {
    category: 'system',
    id: 'typesafe',
    label: 'TypeSafe Jev',
    protocol: 'System One API',
    base: 'https://api.typesafe.ai/v1',
    model: 'jev-latest',
    structured: false,
    key: true,
    structured_reason: '판정 전용',
  },
];
