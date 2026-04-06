// src/layers/llm/__tests__/decomposer.test.ts
// Unit tests for decomposeAndClassify() — callLLM is mocked via jest.mock.

import { decomposeAndClassify } from '../decomposer';
import { buildPrompt } from '../prompt';
import { callLLM } from '../client';

// ---------------------------------------------------------------------------
// Mock callLLM at the module level (matches client.test.ts convention)
// ---------------------------------------------------------------------------

jest.mock('../client', () => ({ callLLM: jest.fn() }));
const mockCallLLM = callLLM as jest.MockedFunction<typeof callLLM>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a diff string with exactly N effective +lines (no +++ or --- noise).
 */
function makeDiff(effectiveLines: number): string {
  return Array.from({ length: effectiveLines }, (_, i) => `+line${i + 1}`).join('\n');
}

function makeLLMResponse(response: string, tokens = 100, cost = 0.001) {
  return {
    prompt: 'mock-prompt',
    response,
    tokens_used: tokens,
    cost_usd: cost,
    model: 'claude-haiku-4-5',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('decomposeAndClassify', () => {
  const candidates = ['tests/auth.test.ts', 'tests/session.test.ts'];

  beforeEach(() => {
    mockCallLLM.mockReset();
  });

  // -------------------------------------------------------------------------
  // TC-D1: 99 effective lines → non-decomposed path
  // -------------------------------------------------------------------------

  it('TC-D1: 99-line diff returns decomposed:false with no LLM calls', async () => {
    const diff = makeDiff(99);
    const result = await decomposeAndClassify(candidates, diff);

    expect(result.decomposed).toBe(false);
    expect(result.llm_calls_made).toBe(0);
    expect(result.tokens_used).toBe(0);
    expect(result.cost_usd).toBe(0);
    expect(result.contextSummary).toBe('');
    expect(result.prompt).toBe(buildPrompt(candidates, diff));
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TC-D2: exactly 100 effective lines → threshold NOT triggered
  // -------------------------------------------------------------------------

  it('TC-D2: exactly 100-line diff returns decomposed:false (boundary is > not >=)', async () => {
    const diff = makeDiff(100);
    const result = await decomposeAndClassify(candidates, diff);

    expect(result.decomposed).toBe(false);
    expect(result.llm_calls_made).toBe(0);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TC-D3: 101 effective lines → decomposed path, 3 LLM calls
  // -------------------------------------------------------------------------

  it('TC-D3: 101-line diff triggers decomposition with 3 LLM calls', async () => {
    const diff = makeDiff(101);

    mockCallLLM
      .mockResolvedValueOnce(makeLLMResponse('auth.ts, session.ts'))   // stage 1
      .mockResolvedValueOnce(makeLLMResponse('login, logout'))         // stage 2
      .mockResolvedValueOnce(makeLLMResponse('Session timeout was reduced from 30 to 15 minutes.')); // stage 3

    const result = await decomposeAndClassify(candidates, diff);

    expect(result.decomposed).toBe(true);
    expect(mockCallLLM).toHaveBeenCalledTimes(3);
    expect(result.llm_calls_made).toBe(3);
    // Enriched prompt must contain the decomposed context block
    expect(result.prompt).toContain('[DECOMPOSED DIFF CONTEXT]');
    expect(result.prompt).toContain('auth.ts, session.ts');
    expect(result.prompt).toContain('login, logout');
  });

  // -------------------------------------------------------------------------
  // TC-D4: stage 1 returns null → fallback 'unknown', still decomposed:true
  // -------------------------------------------------------------------------

  it('TC-D4: stage 1 null → falls back to "unknown", decomposed:true, llm_calls_made:0 for that stage', async () => {
    const diff = makeDiff(101);

    mockCallLLM
      .mockResolvedValueOnce(null)                                      // stage 1 → null
      .mockResolvedValueOnce(makeLLMResponse('login'))                  // stage 2
      .mockResolvedValueOnce(makeLLMResponse('Auth check removed.'));   // stage 3

    const result = await decomposeAndClassify(candidates, diff);

    expect(result.decomposed).toBe(true);
    expect(result.prompt).toContain('[DECOMPOSED DIFF CONTEXT]');
    expect(result.prompt).toContain('Files changed: unknown');
    // Only stage 2 and 3 were non-null
    expect(result.llm_calls_made).toBe(2);
  });

  // -------------------------------------------------------------------------
  // TC-D5: all stages return null → all fallback strings in prompt
  // -------------------------------------------------------------------------

  it('TC-D5: all stages null → fallback strings, decomposed:true, llm_calls_made:0', async () => {
    const diff = makeDiff(101);
    mockCallLLM.mockResolvedValue(null);

    const result = await decomposeAndClassify(candidates, diff);

    expect(result.decomposed).toBe(true);
    expect(result.llm_calls_made).toBe(0);
    expect(result.tokens_used).toBe(0);
    expect(result.cost_usd).toBe(0);
    expect(result.prompt).toContain('Files changed: unknown');
    expect(result.prompt).toContain('Functions changed: unknown');
    expect(result.prompt).toContain('Logic change: a logic change was detected');
  });

  // -------------------------------------------------------------------------
  // TC-D6: all stages succeed → enriched prompt contains stage outputs
  // -------------------------------------------------------------------------

  it('TC-D6: all stages succeed → prompt contains stage 1/2/3 outputs in context block', async () => {
    const diff = makeDiff(101);

    mockCallLLM
      .mockResolvedValueOnce(makeLLMResponse('payments.ts'))
      .mockResolvedValueOnce(makeLLMResponse('processPayment, refund'))
      .mockResolvedValueOnce(makeLLMResponse('Refund logic was updated to apply tax.'));

    const result = await decomposeAndClassify(candidates, diff);

    expect(result.decomposed).toBe(true);
    expect(result.prompt).toContain('[DECOMPOSED DIFF CONTEXT]');
    expect(result.prompt).toContain('Files changed: payments.ts');
    expect(result.prompt).toContain('Functions changed: processPayment, refund');
    expect(result.prompt).toContain('Logic change: Refund logic was updated to apply tax.');
  });

  // -------------------------------------------------------------------------
  // TC-D7: non-decomposed path with architectureNotes → notes passed through
  // -------------------------------------------------------------------------

  it('TC-D7: non-decomposed path preserves architectureNotes unchanged', async () => {
    const diff = makeDiff(99);
    const notes = 'This service handles payments via Stripe.';

    const result = await decomposeAndClassify(candidates, diff, notes);

    expect(result.decomposed).toBe(false);
    expect(result.prompt).toBe(buildPrompt(candidates, diff, notes));
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TC-D8: stages 1 and 3 succeed, stage 2 returns null → token sum is 1+3 only
  // -------------------------------------------------------------------------

  it('TC-D8: tokens_used and cost_usd sum stage 1 and stage 3 only when stage 2 is null', async () => {
    const diff = makeDiff(101);

    const stage1 = makeLLMResponse('api.ts', 200, 0.002);
    const stage3 = makeLLMResponse('API rate limiting was added.', 150, 0.0015);

    mockCallLLM
      .mockResolvedValueOnce(stage1)  // stage 1
      .mockResolvedValueOnce(null)    // stage 2 → null
      .mockResolvedValueOnce(stage3); // stage 3

    const result = await decomposeAndClassify(candidates, diff);

    expect(result.decomposed).toBe(true);
    expect(result.llm_calls_made).toBe(2); // only stages 1 and 3
    expect(result.tokens_used).toBe(stage1.tokens_used + stage3.tokens_used);
    expect(result.cost_usd).toBeCloseTo(stage1.cost_usd + stage3.cost_usd, 10);
    // Stage 2 fallback
    expect(result.prompt).toContain('Functions changed: unknown');
  });
});
