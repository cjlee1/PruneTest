// src/layers/ml/__tests__/features.test.ts

import { extractFeatures } from '../features';
import type { Layer1Result, Layer2Result, RunRecord, TestRecord } from '../../../../shared/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLayer1(depGraph: Record<string, string[]> = {}): Layer1Result {
  return {
    blocking_candidates: [],
    run_full_suite: false,
    dependency_graph: depGraph,
    parsing_errors: [],
    processing_time_ms: 0,
  };
}

function makeLayer2(scores: Record<string, number> = {}): Layer2Result {
  return {
    high_confidence: [],
    medium_confidence: [],
    low_confidence: [],
    similarity_scores: scores,
    cache_hits: 0,
    cache_misses: 0,
    api_cost_usd: 0,
    processing_time_ms: 0,
  };
}

function makeRun(
  overrides: Partial<RunRecord> & { actual_failures?: string[] }
): RunRecord {
  return {
    id: 'run-1',
    repo_id: 'repo-a',
    pr_number: 1,
    sha: 'abc',
    predicted_skip: [],
    actual_failures: [],
    all_tests: [],
    mode: 'shadow',
    created_at: new Date(),
    ...overrides,
  };
}

function makeTest(overrides: Partial<TestRecord>): TestRecord {
  return {
    repo_id: 'repo-a',
    path: 'src/foo.test.ts',
    pass_count: 10,
    fail_count: 0,
    flake_score: 0,
    last_failed_at: null,
    avg_duration_ms: 0,
    ...overrides,
  };
}

const CANDIDATE = 'src/foo.test.ts';
const REPO = 'repo-a';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('extractFeatures', () => {
  test('[0] equals the known similarity score for the candidate', () => {
    const layer2 = makeLayer2({ [CANDIDATE]: 0.75 });
    const result = extractFeatures(CANDIDATE, makeLayer1(), layer2, [], [], REPO);
    expect(result[0]).toBeCloseTo(0.75);
  });

  test('[2] equals 0.3 when candidate fails in 3 of 10 runs', () => {
    const runs: RunRecord[] = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeRun({ id: `fail-${i}`, repo_id: REPO, actual_failures: [CANDIDATE] })
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        makeRun({ id: `pass-${i}`, repo_id: REPO, actual_failures: [] })
      ),
    ];
    const result = extractFeatures(CANDIDATE, makeLayer1(), makeLayer2(), runs, [], REPO);
    expect(result[2]).toBeCloseTo(0.3);
  });

  test('[3] equals 1.0 when candidate has never failed', () => {
    const runs: RunRecord[] = [
      makeRun({ repo_id: REPO, actual_failures: ['other/test.ts'] }),
    ];
    const result = extractFeatures(CANDIDATE, makeLayer1(), makeLayer2(), runs, [], REPO);
    expect(result[3]).toBe(1.0);
  });

  test('[3] equals 1.0 with empty run history', () => {
    const result = extractFeatures(CANDIDATE, makeLayer1(), makeLayer2(), [], [], REPO);
    expect(result[3]).toBe(1.0);
  });

  test('[4] equals 0.5 when TestRecord has flake_score 0.5', () => {
    const tests: TestRecord[] = [makeTest({ path: CANDIDATE, flake_score: 0.5 })];
    const result = extractFeatures(CANDIDATE, makeLayer1(), makeLayer2(), [], tests, REPO);
    expect(result[4]).toBeCloseTo(0.5);
  });

  test('[7] always equals 0.0 regardless of inputs', () => {
    const runs = Array.from({ length: 5 }, (_, i) =>
      makeRun({ id: `r-${i}`, repo_id: REPO, actual_failures: [CANDIDATE] })
    );
    const tests: TestRecord[] = [makeTest({ path: CANDIDATE, flake_score: 0.9 })];
    const result = extractFeatures(CANDIDATE, makeLayer1(), makeLayer2(), runs, tests, REPO);
    expect(result[7]).toBe(0.0);
  });

  test('all returned values are in [0, 1] for well-formed inputs', () => {
    const layer1 = makeLayer1({ 'src/auth.ts': [CANDIDATE] });
    const layer2 = makeLayer2({ [CANDIDATE]: 0.6 });
    const runs: RunRecord[] = [
      makeRun({ id: 'r1', repo_id: REPO, actual_failures: [CANDIDATE], created_at: new Date() }),
      makeRun({ id: 'r2', repo_id: REPO, actual_failures: [], created_at: new Date() }),
    ];
    const tests: TestRecord[] = [
      makeTest({ path: CANDIDATE, flake_score: 0.3, avg_duration_ms: 30_000 }),
    ];
    const result = extractFeatures(CANDIDATE, layer1, layer2, runs, tests, REPO);
    expect(result).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(0);
      expect(result[i]).toBeLessThanOrEqual(1);
    }
  });

  test('candidate not found in any history → Float32Array length 8, all zeros except [3]=1.0', () => {
    const result = extractFeatures(CANDIDATE, makeLayer1(), makeLayer2(), [], [], REPO);
    expect(result).toHaveLength(8);
    expect(result[0]).toBe(0.0); // no similarity score
    expect(result[1]).toBe(0.0); // no graph edges
    expect(result[2]).toBe(0.0); // no failures
    expect(result[3]).toBe(1.0); // never failed = stale
    expect(result[4]).toBe(0.0); // no test record
    expect(result[5]).toBe(0.0); // no test record
    expect(result[6]).toBe(0.0); // no recent runs
    expect(result[7]).toBe(0.0); // reserved
  });
});
