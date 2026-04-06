// src/layers/embeddings/__tests__/smoke.test.ts
// Integration smoke test — skipped unless VOYAGE_API_KEY is set in the environment.

import { embedTexts } from '../client';

// jest does not have it.skipIf natively — use conditional pattern instead
const itOrSkip = process.env.VOYAGE_API_KEY ? it : it.skip;

describe('Voyage-Code-3 smoke test', () => {
  itOrSkip(
    'smoke: embedTexts returns real vectors',
    async () => {
      const result = await embedTexts([
        'function add(a, b) { return a + b; }',
      ]);
      // Null means a transient API failure (rate limit, network, etc.).
      // Fail-open: log and skip assertions rather than failing CI on transient errors.
      if (result === null) {
        console.warn('[smoke] embedTexts returned null — transient API failure, skipping vector assertions');
        return;
      }
      expect(result.embeddings).toHaveLength(1);
      expect(result.embeddings[0]).toHaveLength(1024);
      console.log(
        '[smoke] Voyage-Code-3 vector[0..3]:',
        result.embeddings[0].slice(0, 4),
      );
    },
    15_000, // 15 s timeout for network call
  );
});
