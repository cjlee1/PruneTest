#!/usr/bin/env npx ts-node
// test/integration/ml-integration.ts
// End-to-end integration test for scoreWithML with a properly trained ONNX model.
// Runs outside Jest to avoid VM sandbox realm mismatch with native bindings.
//
// Assertions:
//   1. model_active:true with 100+ RunRecords (dormancy gate open)
//   2. all score values in [0,1]
//   3. model_version === 'gbdt-v1'
//   4. training_runs_available >= 100
//   5. ranked_tests length equals candidates length
//   6. ranked_tests are sorted descending by score
//   7. model_active:false with 99 RunRecords (dormancy gate closed — boundary)
//   8. dormant result has model_version === 'dormant'
//
// Usage: npx ts-node test/integration/ml-integration.ts

import * as path from 'path';
import * as fs from 'fs';
import { scoreWithML } from '../../src/layers/ml/index';
import type { Layer1Result, Layer2Result, RunRecord, TestRecord } from '../../shared/types';

const MODEL_PATH = path.join(__dirname, '../../models/gbdt.onnx');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build N synthetic RunRecord objects, all under the same repo_id so they all
 * count toward the dormancy gate threshold.
 */
function makeRunRecords(n: number, repoId = 'test-repo-integration'): RunRecord[] {
  const testPaths = [
    'test/auth.test.ts',
    'test/session.test.ts',
    'test/api/users.test.ts',
    'test/api/orders.test.ts',
    'test/utils/formatter.test.ts',
  ];
  const records: RunRecord[] = [];
  const base = new Date('2024-01-01T00:00:00.000Z');
  for (let i = 0; i < n; i++) {
    const allTests = testPaths.slice(0, 3 + (i % 3));
    const actualFailures = i % 5 === 0 ? [allTests[0]] : [];
    records.push({
      id: `run-${i}`,
      repo_id: repoId,
      pr_number: 1000 + i,
      sha: `sha${i.toString(16).padStart(40, '0')}`,
      predicted_skip: [],
      actual_failures: actualFailures,
      all_tests: allTests,
      mode: 'shadow',
      created_at: new Date(base.getTime() + i * 86_400_000),
    });
  }
  return records;
}

/** Minimal stub Layer1Result — no blocking candidates, empty dep graph. */
function makeLayer1(): Layer1Result {
  return {
    blocking_candidates: [],
    run_full_suite: false,
    dependency_graph: {},
    parsing_errors: [],
    processing_time_ms: 0,
  };
}

/** Minimal stub Layer2Result — similarity scores 0.5 for all candidates. */
function makeLayer2(candidates: string[]): Layer2Result {
  const scores: Record<string, number> = {};
  for (const c of candidates) {
    scores[c] = 0.5;
  }
  return {
    high_confidence: [],
    medium_confidence: candidates,
    low_confidence: [],
    similarity_scores: scores,
    cache_hits: 0,
    cache_misses: candidates.length,
    api_cost_usd: 0,
    processing_time_ms: 0,
  };
}

/** Minimal stub TestRecord array for the candidates. */
function makeTestRecords(candidates: string[]): TestRecord[] {
  return candidates.map((p) => ({
    repo_id: 'test-repo-integration',
    path: p,
    pass_count: 10,
    fail_count: 2,
    flake_score: 0.1,
    last_failed_at: new Date('2024-06-01T00:00:00.000Z'),
    avg_duration_ms: 1500,
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, label: string): void {
    if (condition) {
      console.log(`  ✅ ${label}`);
      passed++;
    } else {
      console.error(`  ❌ ${label}`);
      failed++;
    }
  }

  console.log('=== ml-integration: end-to-end scoreWithML test ===\n');

  // Pre-check: trained model exists
  assert(fs.existsSync(MODEL_PATH), `Trained model exists at ${MODEL_PATH}`);

  const candidates = [
    'test/auth.test.ts',
    'test/session.test.ts',
    'test/api/users.test.ts',
    'test/api/orders.test.ts',
    'test/utils/formatter.test.ts',
  ];
  const layer1 = makeLayer1();
  const layer2 = makeLayer2(candidates);
  const tests = makeTestRecords(candidates);

  // ── Test A: 100 RunRecords → model_active:true ─────────────────────────────
  console.log('\nTest A: 100 RunRecords → dormancy gate open → model_active:true');
  const runs100 = makeRunRecords(100);
  const resultA = await scoreWithML(candidates, layer1, layer2, runs100, tests);

  assert(resultA.model_active === true, 'model_active is true');
  assert(
    resultA.ranked_tests.every((t) => t.score >= 0 && t.score <= 1),
    'all scores in [0,1]'
  );
  assert(resultA.model_version === 'gbdt-v1', `model_version === 'gbdt-v1' (got: ${resultA.model_version})`);
  assert(
    resultA.training_runs_available >= 100,
    `training_runs_available >= 100 (got: ${resultA.training_runs_available})`
  );
  assert(
    resultA.ranked_tests.length === candidates.length,
    `ranked_tests.length === ${candidates.length} (got: ${resultA.ranked_tests.length})`
  );

  // Verify descending sort
  const scores = resultA.ranked_tests.map((t) => t.score);
  const isSorted = scores.every((s, i) => i === 0 || s <= scores[i - 1]);
  assert(isSorted, 'ranked_tests sorted descending by score');

  console.log(
    '  ranked_tests:',
    resultA.ranked_tests.map((t) => `${path.basename(t.path)}=${t.score.toFixed(4)}`)
  );

  // ── Test B: 200 RunRecords → same guarantees hold at larger scale ──────────
  console.log('\nTest B: 200 RunRecords → model still active and sane');
  const runs200 = makeRunRecords(200);
  const resultB = await scoreWithML(candidates, layer1, layer2, runs200, tests);

  assert(resultB.model_active === true, 'model_active is true with 200 runs');
  assert(
    resultB.training_runs_available >= 200,
    `training_runs_available >= 200 (got: ${resultB.training_runs_available})`
  );

  // ── Test C: 99 RunRecords → dormancy gate closed → model_active:false ──────
  console.log('\nTest C: 99 RunRecords → dormancy gate closed → model_active:false');
  const runs99 = makeRunRecords(99);
  const resultC = await scoreWithML(candidates, layer1, layer2, runs99, tests);

  assert(resultC.model_active === false, 'model_active is false with 99 runs (boundary)');
  assert(
    resultC.model_version === 'dormant',
    `model_version === 'dormant' (got: ${resultC.model_version})`
  );
  assert(
    resultC.training_runs_available === 99,
    `training_runs_available === 99 (got: ${resultC.training_runs_available})`
  );

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
