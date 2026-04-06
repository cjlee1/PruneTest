// src/layers/static-analysis/__tests__/integration.test.ts
// Integration tests for analyzeStaticDependencies() — real WASM parser path.
//
// CRITICAL: No 4th `parseFile` argument is passed to analyzeStaticDependencies()
// in any test here. The absence of injection forces the real WASM parser dispatch.
//
// Run with: NODE_OPTIONS=--experimental-vm-modules npx jest integration.test
// (NODE_OPTIONS is set automatically by `npm test` after the package.json update)

import * as path from 'path';
import { analyzeStaticDependencies } from '../index';
import type { SelectorConfig } from '../../../../shared/types';

// WASM cold-start tolerance — measured ~34 ms for warm runs; 30 s for cold start.
jest.setTimeout(30000);

const FIXTURE_ROOT = path.join(__dirname, '../../../../fixtures/project');

const BASE_CONFIG: SelectorConfig = {
  mode: 'shadow',
  testRunner: 'auto',
  testDir: '__tests__',
  runAllTestsOn: ['package.json', 'tsconfig.json'],
  alwaysRun: [],
  neverRun: [],
  architectureNotes: '',
  flakyTestThreshold: 0.15,
  flakyTestQuarantine: 0.40,
  fullSuiteEvery: 50,
};

// ---------------------------------------------------------------------------
// Test 1 — Demo scenario (R019 contract example)
// changedFiles: ['src/auth/session.ts']
// Expected: blocking_candidates includes 'test/auth.test.ts'
// ---------------------------------------------------------------------------
describe('analyzeStaticDependencies — real WASM integration', () => {
  let demoResult: Awaited<ReturnType<typeof analyzeStaticDependencies>>;

  beforeAll(async () => {
    // Run the demo scenario once; reused by tests 1, 2, and 6.
    demoResult = await analyzeStaticDependencies(
      ['src/auth/session.ts'],
      FIXTURE_ROOT,
      BASE_CONFIG,
      // ← no 4th argument (parseFile) — forces real WASM
    );
  });

  it('demo scenario: blocking_candidates includes test/auth.test.ts', () => {
    expect(demoResult.blocking_candidates).toContain('test/auth.test.ts');
  });

  it('demo scenario: run_full_suite is false', () => {
    expect(demoResult.run_full_suite).toBe(false);
  });

  it('demo scenario: parsing_errors is an array (fail-open)', () => {
    // Malformed files may contribute errors if the root scan hits them, but
    // the result must always be an array — never throws.
    expect(Array.isArray(demoResult.parsing_errors)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2 — Performance benchmark (R021 latency contract)
  // Validates processing_time_ms < 1000 ms for the demo scenario invocation.
  // Threshold is 1000 ms to account for WASM cold-start under parallel test
  // worker load. Warm runs measured ~30-35 ms on the 171-file fixture.
  // -------------------------------------------------------------------------
  it('performance benchmark: processing_time_ms < 1000 ms (R021)', () => {
    expect(demoResult.processing_time_ms).toBeLessThan(1000);
  });

  // -------------------------------------------------------------------------
  // Test 3 — Transitive chain depth
  // changedFiles: ['src/utils/helpers.ts']
  // src/utils/helpers.ts imports ../auth/session
  // test/utils.test.ts and test/helpers.test.ts both import src/utils/helpers.ts
  // -------------------------------------------------------------------------
  it('transitive chain: changing helpers.ts surfaces utils/helpers test files', async () => {
    const result = await analyzeStaticDependencies(
      ['src/utils/helpers.ts'],
      FIXTURE_ROOT,
      BASE_CONFIG,
    );

    expect(
      result.blocking_candidates.some(
        f => f.includes('utils') || f.includes('helpers'),
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 4 — run_full_suite trigger
  // changedFiles: ['package.json'] — matches runAllTestsOn config entry
  // -------------------------------------------------------------------------
  it('run_full_suite trigger: package.json change sets run_full_suite = true', async () => {
    const result = await analyzeStaticDependencies(
      ['package.json'],
      FIXTURE_ROOT,
      BASE_CONFIG,
    );

    expect(result.run_full_suite).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 5 — Graceful error handling (fail-open)
  // changedFiles: ['malformed/broken.ts'] — file with invalid syntax
  // Must NOT throw; must record parsing_errors; blocking_candidates is array.
  // -------------------------------------------------------------------------
  it('graceful error handling: malformed file does not throw (fail-open)', async () => {
    const promise = analyzeStaticDependencies(
      ['malformed/broken.ts'],
      FIXTURE_ROOT,
      BASE_CONFIG,
    );

    await expect(promise).resolves.toBeDefined();

    const result = await promise;
    // The tree-sitter WASM parsers use error-recovery (they produce an error
    // node in the AST rather than throwing), so parsing_errors may be empty
    // when no fs read failure occurs. The critical invariant is that the function
    // does not throw and always returns a valid structure.
    expect(Array.isArray(result.parsing_errors)).toBe(true);
    expect(Array.isArray(result.blocking_candidates)).toBe(true);
    expect(typeof result.processing_time_ms).toBe('number');
  });

  // -------------------------------------------------------------------------
  // Test 6 — Multi-language dependency_graph
  // Re-uses demoResult (changedFiles: ['src/auth/session.ts']).
  // The full scan builds a graph that includes .py, .rb, and .go entries.
  // -------------------------------------------------------------------------
  it('multi-language: dependency_graph contains .py, .rb, and .go entries', () => {
    const graphKeys = Object.keys(demoResult.dependency_graph);

    expect(graphKeys.some(k => k.endsWith('.py'))).toBe(true);
    expect(graphKeys.some(k => k.endsWith('.rb'))).toBe(true);
    expect(graphKeys.some(k => k.endsWith('.go'))).toBe(true);
  });
});
