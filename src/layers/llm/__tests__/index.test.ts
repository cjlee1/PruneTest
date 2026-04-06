// src/layers/llm/__tests__/index.test.ts
// Unit tests for classifyWithLLM() — callLLM is mocked via jest.mock.
// TC-I1 through TC-I11 cover all branches in index.ts.

import { classifyWithLLM } from '../index';
import { callLLM } from '../client';
import type { LLMResponse, SelectorConfig, Layer2Result } from '../../../../shared/types';

// ---------------------------------------------------------------------------
// Mock callLLM only — decomposer, prompt, etc. run for real
// ---------------------------------------------------------------------------

jest.mock('../client', () => ({ callLLM: jest.fn() }));
const mockCallLLM = callLLM as jest.MockedFunction<typeof callLLM>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(jsonObj: object): LLMResponse {
  return {
    prompt: '',
    response: JSON.stringify(jsonObj),
    tokens_used: 10,
    cost_usd: 0.00001,
    model: 'claude-haiku-4-5',
  };
}

function makeDecisionsResponse(decisions: object[]): LLMResponse {
  return makeResponse({ decisions });
}

function makeDecision(
  test_path: string,
  classification: 'blocking' | 'recommended' | 'skip' = 'blocking',
): { test_path: string; classification: string; confidence: number; reasoning: string } {
  return { test_path, classification, confidence: 0.9, reasoning: 'test reason' };
}

function makeConfig(mode: SelectorConfig['mode'] = 'standard'): SelectorConfig {
  return {
    mode,
    architectureNotes: '',
    testRunner: 'auto',
    testDir: '__tests__',
    runAllTestsOn: [],
    alwaysRun: [],
    neverRun: [],
    flakyTestThreshold: 0.15,
    flakyTestQuarantine: 0.40,
    fullSuiteEvery: 50,
  };
}

function makeLayer2(): Layer2Result {
  return {
    high_confidence: [],
    medium_confidence: [],
    low_confidence: [],
    similarity_scores: {},
    cache_hits: 0,
    cache_misses: 0,
    api_cost_usd: 0,
    processing_time_ms: 0,
  };
}

/** Build a diff with exactly N effective +lines (no +++ or --- noise). */
function makeDiff(n: number): string {
  return Array.from({ length: n }, (_, i) => `+line${i + 1}`).join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('classifyWithLLM', () => {
  beforeEach(() => {
    mockCallLLM.mockReset();
  });

  // -------------------------------------------------------------------------
  // TC-I1: empty candidates → short-circuit, no LLM calls, fallback_used false
  // -------------------------------------------------------------------------

  it('TC-I1: empty candidates → short-circuit, fallback_used=false, 0 LLM calls', async () => {
    const result = await classifyWithLLM([], makeDiff(5), makeLayer2(), makeConfig());

    expect(result.decisions).toEqual([]);
    expect(result.fallback_used).toBe(false);
    expect(result.llm_calls_made).toBe(0);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TC-I2: non-conservative, small diff, valid JSON on first call
  // -------------------------------------------------------------------------

  it('TC-I2: non-conservative, small diff, valid JSON response on first call', async () => {
    const decision = makeDecision('tests/auth.test.ts', 'blocking');
    mockCallLLM.mockResolvedValueOnce(makeDecisionsResponse([decision]));

    const result = await classifyWithLLM(
      ['tests/auth.test.ts'],
      makeDiff(10),
      makeLayer2(),
      makeConfig('standard'),
    );

    expect(result.fallback_used).toBe(false);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].test_path).toBe('tests/auth.test.ts');
    expect(result.decisions[0].classification).toBe('blocking');
    // decomposer made 0 calls (small diff) + 1 classification call
    expect(result.llm_calls_made).toBe(1);
    expect(result.total_tokens_used).toBe(10);
    expect(result.cost_usd).toBeCloseTo(0.00001);
  });

  // -------------------------------------------------------------------------
  // TC-I3: JSON parse failure on first call → retry → valid JSON
  // -------------------------------------------------------------------------

  it('TC-I3: first call returns invalid JSON → retry → valid JSON', async () => {
    const decision = makeDecision('tests/session.test.ts', 'recommended');
    // First call: invalid JSON
    mockCallLLM.mockResolvedValueOnce({
      prompt: '',
      response: 'not valid json at all',
      tokens_used: 10,
      cost_usd: 0.00001,
      model: 'claude-haiku-4-5',
    });
    // Retry: valid JSON
    mockCallLLM.mockResolvedValueOnce(makeDecisionsResponse([decision]));

    const result = await classifyWithLLM(
      ['tests/session.test.ts'],
      makeDiff(10),
      makeLayer2(),
      makeConfig('standard'),
    );

    expect(result.fallback_used).toBe(false);
    expect(result.llm_calls_made).toBe(2);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].test_path).toBe('tests/session.test.ts');
    expect(result.decisions[0].classification).toBe('recommended');
  });

  // -------------------------------------------------------------------------
  // TC-I4: first call bad JSON → retry also bad JSON → fallback
  // -------------------------------------------------------------------------

  it('TC-I4: both calls return invalid JSON → fallback_used=true', async () => {
    mockCallLLM
      .mockResolvedValueOnce({
        prompt: '',
        response: 'bad json 1',
        tokens_used: 10,
        cost_usd: 0.00001,
        model: 'claude-haiku-4-5',
      })
      .mockResolvedValueOnce({
        prompt: '',
        response: 'bad json 2',
        tokens_used: 10,
        cost_usd: 0.00001,
        model: 'claude-haiku-4-5',
      });

    const result = await classifyWithLLM(
      ['tests/auth.test.ts'],
      makeDiff(10),
      makeLayer2(),
      makeConfig('standard'),
    );

    expect(result.fallback_used).toBe(true);
    expect(result.decisions).toEqual([]);
    expect(result.llm_calls_made).toBe(2);
  });

  // -------------------------------------------------------------------------
  // TC-I5: callLLM returns null on first call → retry → null again → fallback
  // -------------------------------------------------------------------------

  it('TC-I5: both callLLM calls return null → fallback_used=true, decisions=[]', async () => {
    mockCallLLM
      .mockResolvedValueOnce(null) // first call
      .mockResolvedValueOnce(null); // retry

    const result = await classifyWithLLM(
      ['tests/auth.test.ts'],
      makeDiff(10),
      makeLayer2(),
      makeConfig('standard'),
    );

    expect(result.fallback_used).toBe(true);
    expect(result.decisions).toEqual([]);
    // null responses don't increment llm_calls_made
    expect(result.llm_calls_made).toBe(0);
  });

  // -------------------------------------------------------------------------
  // TC-I6: Conservative mode, all 3 passes succeed, union decisions
  // -------------------------------------------------------------------------

  it('TC-I6: conservative mode, 3 passes all succeed → union decisions, llm_calls_made=3', async () => {
    const dec1 = makeDecision('tests/auth.test.ts', 'blocking');
    const dec2 = makeDecision('tests/session.test.ts', 'recommended');
    const dec3 = makeDecision('tests/user.test.ts', 'skip');

    // Pass 0 (alphabetical): returns dec1
    mockCallLLM.mockResolvedValueOnce(makeDecisionsResponse([dec1]));
    // Pass 1 (reverse): returns dec2
    mockCallLLM.mockResolvedValueOnce(makeDecisionsResponse([dec2]));
    // Pass 2 (interleaved): returns dec3
    mockCallLLM.mockResolvedValueOnce(makeDecisionsResponse([dec3]));

    const result = await classifyWithLLM(
      ['tests/auth.test.ts', 'tests/session.test.ts', 'tests/user.test.ts'],
      makeDiff(10),
      makeLayer2(),
      makeConfig('conservative'),
    );

    expect(result.fallback_used).toBe(false);
    expect(result.llm_calls_made).toBe(3);
    // All 3 unique test_paths should appear in the union
    const paths = result.decisions.map((d) => d.test_path).sort();
    expect(paths).toContain('tests/auth.test.ts');
    expect(paths).toContain('tests/session.test.ts');
    expect(paths).toContain('tests/user.test.ts');
  });

  // -------------------------------------------------------------------------
  // TC-I7: Conservative, pass 1 returns null/bad JSON → passes 0+2 succeed
  // -------------------------------------------------------------------------

  it('TC-I7: conservative, pass 1 fails → fallback_used=false (passes 0+2 succeed)', async () => {
    const dec1 = makeDecision('tests/auth.test.ts', 'blocking');
    const dec2 = makeDecision('tests/user.test.ts', 'recommended');

    // Pass 0: succeeds
    mockCallLLM.mockResolvedValueOnce(makeDecisionsResponse([dec1]));
    // Pass 1: first call returns null → retry also null
    mockCallLLM.mockResolvedValueOnce(null); // r1 for pass1
    mockCallLLM.mockResolvedValueOnce(null); // r2 retry for pass1
    // Pass 2: succeeds
    mockCallLLM.mockResolvedValueOnce(makeDecisionsResponse([dec2]));

    const result = await classifyWithLLM(
      ['tests/auth.test.ts', 'tests/user.test.ts'],
      makeDiff(10),
      makeLayer2(),
      makeConfig('conservative'),
    );

    expect(result.fallback_used).toBe(false);
    const paths = result.decisions.map((d) => d.test_path).sort();
    expect(paths).toContain('tests/auth.test.ts');
    expect(paths).toContain('tests/user.test.ts');
    // Pass 1 made 0 successful calls (both null); passes 0 and 2 made 1 each
    expect(result.llm_calls_made).toBe(2);
  });

  // -------------------------------------------------------------------------
  // TC-I8: Conservative, all 3 passes fail → fallback_used=true
  // -------------------------------------------------------------------------

  it('TC-I8: conservative, all 3 passes fail → fallback_used=true, decisions=[]', async () => {
    // Each pass: r1 null → r2 null (2 calls per pass = 6 total)
    for (let i = 0; i < 6; i++) {
      mockCallLLM.mockResolvedValueOnce(null);
    }

    const result = await classifyWithLLM(
      ['tests/auth.test.ts'],
      makeDiff(10),
      makeLayer2(),
      makeConfig('conservative'),
    );

    expect(result.fallback_used).toBe(true);
    expect(result.decisions).toEqual([]);
    // All null → 0 successful calls
    expect(result.llm_calls_made).toBe(0);
  });

  // -------------------------------------------------------------------------
  // TC-I9: Conservative, same test_path → most-conservative wins (blocking > skip)
  // -------------------------------------------------------------------------

  it('TC-I9: conservative, same test_path classified differently → blocking wins over skip', async () => {
    // Pass 0: blocking
    mockCallLLM.mockResolvedValueOnce(
      makeDecisionsResponse([makeDecision('tests/auth.test.ts', 'blocking')]),
    );
    // Pass 1: skip
    mockCallLLM.mockResolvedValueOnce(
      makeDecisionsResponse([makeDecision('tests/auth.test.ts', 'skip')]),
    );
    // Pass 2: recommended
    mockCallLLM.mockResolvedValueOnce(
      makeDecisionsResponse([makeDecision('tests/auth.test.ts', 'recommended')]),
    );

    const result = await classifyWithLLM(
      ['tests/auth.test.ts'],
      makeDiff(10),
      makeLayer2(),
      makeConfig('conservative'),
    );

    expect(result.fallback_used).toBe(false);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].classification).toBe('blocking');
  });

  // -------------------------------------------------------------------------
  // TC-I10: Large diff → decomposer runs 3 LLM calls, then 1 classification call
  // -------------------------------------------------------------------------

  it('TC-I10: large diff (101 lines) → decomposer 3 calls + classification 1 call = 4+ total', async () => {
    // Decomposer stage 1
    mockCallLLM.mockResolvedValueOnce({
      prompt: '',
      response: 'auth.ts, session.ts',
      tokens_used: 10,
      cost_usd: 0.00001,
      model: 'claude-haiku-4-5',
    });
    // Decomposer stage 2
    mockCallLLM.mockResolvedValueOnce({
      prompt: '',
      response: 'login, logout',
      tokens_used: 10,
      cost_usd: 0.00001,
      model: 'claude-haiku-4-5',
    });
    // Decomposer stage 3
    mockCallLLM.mockResolvedValueOnce({
      prompt: '',
      response: 'Session timeout was changed.',
      tokens_used: 10,
      cost_usd: 0.00001,
      model: 'claude-haiku-4-5',
    });
    // Classification call
    mockCallLLM.mockResolvedValueOnce(
      makeDecisionsResponse([makeDecision('tests/auth.test.ts', 'blocking')]),
    );

    const result = await classifyWithLLM(
      ['tests/auth.test.ts'],
      makeDiff(101),
      makeLayer2(),
      makeConfig('standard'),
    );

    expect(result.fallback_used).toBe(false);
    // 3 decomposer + 1 classification
    expect(result.llm_calls_made).toBeGreaterThanOrEqual(4);
    // 4 calls × 10 tokens each = 40
    expect(result.total_tokens_used).toBeGreaterThanOrEqual(40);
  });

  // -------------------------------------------------------------------------
  // TC-I11: processing_time_ms > 0
  // -------------------------------------------------------------------------

  it('TC-I11: processing_time_ms is greater than 0 for any real call', async () => {
    // Introduce a 5ms artificial delay so Date.now() diff is guaranteed > 0
    mockCallLLM.mockImplementationOnce(
      () =>
        new Promise<LLMResponse>((resolve) =>
          setTimeout(
            () => resolve(makeDecisionsResponse([makeDecision('tests/auth.test.ts', 'blocking')])),
            5,
          ),
        ),
    );

    const result = await classifyWithLLM(
      ['tests/auth.test.ts'],
      makeDiff(10),
      makeLayer2(),
      makeConfig('standard'),
    );

    expect(result.processing_time_ms).toBeGreaterThan(0);
  });
});
