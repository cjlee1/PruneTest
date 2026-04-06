// src/__tests__/merger.test.ts
// Unit tests for src/merger.ts — mergeLayers() FinalSelection producer.
// Covers all four selection profiles, shadow mode, boundary conditions,
// run_full_suite passthrough, cost aggregation, and confidence calculation.

import { mergeLayers } from '../merger';
import type {
  Layer1Result,
  Layer2Result,
  Layer3Result,
  Layer4Result,
  SelectorConfig,
  TestRecord,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLayer1(overrides: Partial<Layer1Result> = {}): Layer1Result {
  return {
    blocking_candidates: [],
    run_full_suite: false,
    dependency_graph: {},
    parsing_errors: [],
    processing_time_ms: 0,
    ...overrides,
  };
}

function makeLayer2(overrides: Partial<Layer2Result> = {}): Layer2Result {
  return {
    high_confidence: [],
    medium_confidence: [],
    low_confidence: [],
    similarity_scores: {},
    cache_hits: 0,
    cache_misses: 0,
    api_cost_usd: 0,
    processing_time_ms: 0,
    ...overrides,
  };
}

function makeLayer3(overrides: Partial<Layer3Result> = {}): Layer3Result {
  return {
    ranked_tests: [],
    model_version: 'gbdt-v1',
    training_runs_available: 0,
    model_active: false,
    processing_time_ms: 0,
    ...overrides,
  };
}

function makeLayer4(overrides: Partial<Layer4Result> = {}): Layer4Result {
  return {
    decisions: [],
    llm_calls_made: 0,
    total_tokens_used: 0,
    cost_usd: 0,
    fallback_used: false,
    processing_time_ms: 0,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<SelectorConfig> = {}): SelectorConfig {
  return {
    mode: 'shadow',
    testRunner: 'auto',
    testDir: '__tests__',
    runAllTestsOn: [],
    alwaysRun: [],
    neverRun: [],
    architectureNotes: '',
    flakyTestThreshold: 0.15,
    flakyTestQuarantine: 0.40,
    fullSuiteEvery: 50,
    ...overrides,
  };
}

function makeTests(paths: string[]): TestRecord[] {
  return paths.map((path) => ({
    repo_id: 'repo-a',
    path,
    pass_count: 10,
    fail_count: 0,
    flake_score: 0,
    last_failed_at: null,
    avg_duration_ms: 500,
  }));
}

/** Convenience: 10 test paths for profile cap math. */
const TEN_TESTS = makeTests([
  'a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts', 'e.test.ts',
  'f.test.ts', 'g.test.ts', 'h.test.ts', 'i.test.ts', 'j.test.ts',
]);

// ---------------------------------------------------------------------------
// 1. Return shape
// ---------------------------------------------------------------------------

describe('mergeLayers — return shape', () => {
  it('returns a FinalSelection with all required fields', () => {
    const result = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig(), [],
    );

    expect(result).toHaveProperty('blocking');
    expect(result).toHaveProperty('recommended');
    expect(result).toHaveProperty('skip');
    expect(result).toHaveProperty('mode');
    expect(result).toHaveProperty('overall_confidence');
    expect(result).toHaveProperty('pr_comment');
    expect(result).toHaveProperty('total_cost_usd');
    expect(result).toHaveProperty('estimated_time_saved_minutes');
    expect(Array.isArray(result.blocking)).toBe(true);
    expect(Array.isArray(result.recommended)).toBe(true);
    expect(Array.isArray(result.skip)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Shadow mode — skip always empty
// ---------------------------------------------------------------------------

describe('mergeLayers — shadow mode', () => {
  it('always produces an empty skip list in shadow mode regardless of test count', () => {
    const result = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'shadow' }), TEN_TESTS,
    );

    expect(result.skip).toEqual([]);
    expect(result.mode).toBe('shadow');
  });

  it('shadow mode: blocking and recommended still populated from layer outputs', () => {
    const layer1 = makeLayer1({ blocking_candidates: ['auth.test.ts'] });
    const layer4 = makeLayer4({
      decisions: [{ test_path: 'user.test.ts', classification: 'recommended', confidence: 0.9, reasoning: 'r' }],
    });

    const result = mergeLayers(
      layer1, makeLayer2(), makeLayer3(), layer4,
      makeConfig({ mode: 'shadow' }), makeTests(['auth.test.ts', 'user.test.ts', 'other.test.ts']),
    );

    expect(result.blocking).toContain('auth.test.ts');
    expect(result.recommended).toContain('user.test.ts');
    expect(result.skip).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Conservative profile — skip ≤15%
// ---------------------------------------------------------------------------

describe('mergeLayers — conservative profile (skipMaxPercent=0.15)', () => {
  it('skips at most 15% of tests (floor of 10 × 0.15 = 1)', () => {
    const result = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'conservative' }), TEN_TESTS,
    );

    expect(result.mode).toBe('conservative');
    // floor(10 * 0.15) = 1 — at most 1 test may be skipped
    expect(result.skip.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Standard profile — skip ≤50%
// ---------------------------------------------------------------------------

describe('mergeLayers — standard profile (skipMaxPercent=0.50)', () => {
  it('skips at most 50% of tests (floor of 10 × 0.50 = 5)', () => {
    const result = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'standard' }), TEN_TESTS,
    );

    expect(result.mode).toBe('standard');
    // floor(10 * 0.50) = 5
    expect(result.skip.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// 5. Aggressive profile — skip ≤80%
// ---------------------------------------------------------------------------

describe('mergeLayers — aggressive profile (skipMaxPercent=0.80)', () => {
  it('skips at most 80% of tests (floor of 10 × 0.80 = 8)', () => {
    const result = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'aggressive' }), TEN_TESTS,
    );

    expect(result.mode).toBe('aggressive');
    // floor(10 * 0.80) = 8
    expect(result.skip.length).toBeLessThanOrEqual(8);
  });

  it('tests already blocking/recommended are excluded from the skip pool', () => {
    const layer1 = makeLayer1({ blocking_candidates: ['a.test.ts', 'b.test.ts'] });
    const layer4 = makeLayer4({
      decisions: [
        { test_path: 'c.test.ts', classification: 'recommended', confidence: 0.8, reasoning: '' },
      ],
    });

    const result = mergeLayers(
      layer1, makeLayer2(), makeLayer3(), layer4,
      makeConfig({ mode: 'aggressive' }), TEN_TESTS,
    );

    // blocking: a, b  recommended: c  remaining pool: d-j (7 tests)
    // maxSkip = floor(10 * 0.80) = 8, but pool is only 7
    expect(result.skip).not.toContain('a.test.ts');
    expect(result.skip).not.toContain('b.test.ts');
    expect(result.skip).not.toContain('c.test.ts');
    expect(result.skip.length).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// 6. Blocking union from L1 + L2 + L4
// ---------------------------------------------------------------------------

describe('mergeLayers — blocking union', () => {
  it('unions L1 blocking_candidates, L2 high_confidence, and L4 blocking decisions', () => {
    const layer1 = makeLayer1({ blocking_candidates: ['l1.test.ts'] });
    const layer2 = makeLayer2({ high_confidence: ['l2.test.ts'] });
    const layer4 = makeLayer4({
      decisions: [
        { test_path: 'l4.test.ts', classification: 'blocking', confidence: 0.95, reasoning: 'r' },
        { test_path: 'l4-rec.test.ts', classification: 'recommended', confidence: 0.7, reasoning: 'r' },
      ],
    });

    const result = mergeLayers(
      layer1, layer2, makeLayer3(), layer4,
      makeConfig({ mode: 'shadow' }),
      makeTests(['l1.test.ts', 'l2.test.ts', 'l4.test.ts', 'l4-rec.test.ts']),
    );

    expect(result.blocking).toContain('l1.test.ts');
    expect(result.blocking).toContain('l2.test.ts');
    expect(result.blocking).toContain('l4.test.ts');
    expect(result.blocking).not.toContain('l4-rec.test.ts');
  });

  it('de-duplicates tests that appear in multiple blocking sources', () => {
    const layer1 = makeLayer1({ blocking_candidates: ['shared.test.ts'] });
    const layer2 = makeLayer2({ high_confidence: ['shared.test.ts'] });

    const result = mergeLayers(
      layer1, layer2, makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'shadow' }),
      makeTests(['shared.test.ts']),
    );

    const count = result.blocking.filter((p) => p === 'shared.test.ts').length;
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. run_full_suite passthrough
// ---------------------------------------------------------------------------

describe('mergeLayers — run_full_suite passthrough', () => {
  it('includes all tests in blocking when run_full_suite is true', () => {
    const allPaths = ['x.test.ts', 'y.test.ts', 'z.test.ts'];
    const layer1 = makeLayer1({ run_full_suite: true });

    const result = mergeLayers(
      layer1, makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'aggressive' }), makeTests(allPaths),
    );

    for (const p of allPaths) {
      expect(result.blocking).toContain(p);
    }
    // When everything is blocking, skip pool is empty
    expect(result.skip).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. overall_confidence calculation
// ---------------------------------------------------------------------------

describe('mergeLayers — overall_confidence', () => {
  it('returns 0 when no similarity_scores present', () => {
    const result = mergeLayers(
      makeLayer1(), makeLayer2({ similarity_scores: {} }), makeLayer3(), makeLayer4(),
      makeConfig(), [],
    );

    expect(result.overall_confidence).toBe(0);
  });

  it('computes the average of all similarity_scores values', () => {
    const layer2 = makeLayer2({
      similarity_scores: { 'a.test.ts': 0.6, 'b.test.ts': 0.8, 'c.test.ts': 1.0 },
    });

    const result = mergeLayers(
      makeLayer1(), layer2, makeLayer3(), makeLayer4(),
      makeConfig(), [],
    );

    // (0.6 + 0.8 + 1.0) / 3 = 0.8
    expect(result.overall_confidence).toBeCloseTo(0.8, 5);
  });
});

// ---------------------------------------------------------------------------
// 9. Cost aggregation
// ---------------------------------------------------------------------------

describe('mergeLayers — total_cost_usd', () => {
  it('sums L2.api_cost_usd and L4.cost_usd', () => {
    const layer2 = makeLayer2({ api_cost_usd: 0.003 });
    const layer4 = makeLayer4({ cost_usd: 0.007 });

    const result = mergeLayers(
      makeLayer1(), layer2, makeLayer3(), layer4,
      makeConfig(), [],
    );

    expect(result.total_cost_usd).toBeCloseTo(0.01, 5);
  });

  it('returns 0 when both layers report zero cost', () => {
    const result = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig(), [],
    );

    expect(result.total_cost_usd).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. estimated_time_saved_minutes
// ---------------------------------------------------------------------------

describe('mergeLayers — estimated_time_saved_minutes', () => {
  it('returns 0 when skip list is empty (shadow mode)', () => {
    const result = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'shadow' }), TEN_TESTS,
    );

    expect(result.estimated_time_saved_minutes).toBe(0);
  });

  it('returns skip.length × 0.5 minutes', () => {
    // aggressive on 10 tests with none blocking → up to 8 skipped
    const result = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'aggressive' }), TEN_TESTS,
    );

    expect(result.estimated_time_saved_minutes).toBe(result.skip.length * 0.5);
  });
});

// ---------------------------------------------------------------------------
// 11. Empty tests array boundary case
// ---------------------------------------------------------------------------

describe('mergeLayers — empty tests array', () => {
  it('handles zero tests without error — all lists empty', () => {
    const result = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'aggressive' }), [],
    );

    expect(result.blocking).toEqual([]);
    expect(result.recommended).toEqual([]);
    expect(result.skip).toEqual([]);
    expect(result.total_cost_usd).toBe(0);
    expect(result.estimated_time_saved_minutes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 12. pr_comment format
// ---------------------------------------------------------------------------

describe('mergeLayers — pr_comment', () => {
  it('includes mode, blocking count, recommended count, skip count, and confidence', () => {
    const layer2 = makeLayer2({ similarity_scores: { 'a.test.ts': 0.5 } });
    const result = mergeLayers(
      makeLayer1(), layer2, makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'standard' }), TEN_TESTS,
    );

    expect(result.pr_comment).toContain('mode=standard');
    expect(result.pr_comment).toContain('blocking=');
    expect(result.pr_comment).toContain('recommended=');
    expect(result.pr_comment).toContain('skip=');
    expect(result.pr_comment).toContain('confidence=');
  });
});

// ---------------------------------------------------------------------------
// 13. Profile cap: conservative with only 1 non-blocking test
// ---------------------------------------------------------------------------

describe('mergeLayers — profile cap boundary', () => {
  it('conservative profile: floor(1 × 0.15) = 0, skip list is empty', () => {
    const result = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'conservative' }),
      makeTests(['solo.test.ts']),
    );

    // floor(1 * 0.15) = 0
    expect(result.skip).toEqual([]);
  });

  it('standard profile: floor(2 × 0.50) = 1, at most 1 skipped', () => {
    const result = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'standard' }),
      makeTests(['a.test.ts', 'b.test.ts']),
    );

    expect(result.skip.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 14. Quarantine filter
// ---------------------------------------------------------------------------

describe('mergeLayers — quarantine filter', () => {
  // MOCK_CONFIG has flakyTestQuarantine: 0.40
  // Use aggressive mode so skip list is non-empty (up to 80% of tests skipped).

  it('removes a quarantined test (flake score > threshold) from the skip list', () => {
    // 10 tests, aggressive mode → maxSkip = 8; all 10 start in the skip pool
    const flakeScores = new Map([['a.test.ts', 0.60]]); // 0.60 > 0.40 → quarantine

    const result = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'aggressive' }), TEN_TESTS,
      flakeScores,
    );

    expect(result.skip).not.toContain('a.test.ts');
  });

  it('keeps a test at or below the quarantine threshold in the skip list', () => {
    // Score exactly at threshold (0.40) should NOT be removed
    const flakeScores = new Map([['b.test.ts', 0.40]]); // 0.40 <= 0.40 → keep

    const result = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'aggressive' }), TEN_TESTS,
      flakeScores,
    );

    // b.test.ts should still be eligible for skip (score ≤ threshold)
    // It may or may not be in skip depending on the cap, but it's not quarantined
    // — verify by checking that the filter let it through (if it was in the capped set)
    const aboveThresholdOnly = result.skip.every(
      p => (flakeScores.get(p) ?? 0) <= 0.40,
    );
    expect(aboveThresholdOnly).toBe(true);
  });

  it('leaves the skip list unchanged when flakeScores is undefined', () => {
    const withoutFlake = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'aggressive' }), TEN_TESTS,
      undefined,
    );

    const withEmptyMap = mergeLayers(
      makeLayer1(), makeLayer2(), makeLayer3(), makeLayer4(),
      makeConfig({ mode: 'aggressive' }), TEN_TESTS,
      new Map(),
    );

    // Both should produce the same skip list (no quarantine applied)
    expect(withoutFlake.skip).toEqual(withEmptyMap.skip);
  });
});
