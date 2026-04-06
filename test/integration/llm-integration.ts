#!/usr/bin/env npx ts-node
// test/integration/llm-integration.ts
// Integration smoke test for classifyWithLLM() — exercises the real Anthropic
// (primary) or OpenAI (fallback) API and validates the Layer4Result shape.
//
// Assertions:
//   1. result !== null and fallback_used === false
//   2. decisions.length > 0
//   3. decisions[0].reasoning.length > 0
//   4. llm_calls_made >= 1
//   5. classifyDiffType returns a valid classification string
//
// Usage:
//   ANTHROPIC_API_KEY=<key> npx ts-node test/integration/llm-integration.ts
//   OPENAI_API_KEY=<key>    npx ts-node test/integration/llm-integration.ts

import { classifyWithLLM } from '../../src/layers/llm/index';
import { classifyDiffType } from '../../src/layers/llm/pr-classifier';
import type { Layer2Result, SelectorConfig, Layer4Result } from '../../shared/types';

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

  console.log('=== llm-integration: integration test for classifyWithLLM() ===\n');

  // Preflight: require at least one API key
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error(
      'ERROR: Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set. ' +
        'At least one key is required to run this integration test.',
    );
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Build synthetic medium-confidence candidates (alphabetically ordered)
  // ---------------------------------------------------------------------------
  const candidates: string[] = [
    'src/__tests__/auth.test.ts',
    'src/__tests__/config.test.ts',
    'src/__tests__/merger.test.ts',
    'src/__tests__/shadow-mode.test.ts',
  ];

  // ---------------------------------------------------------------------------
  // Build a small synthetic diff (~20 lines) adding a new `validateUser` fn
  // ---------------------------------------------------------------------------
  const diff = [
    'diff --git a/src/auth.ts b/src/auth.ts',
    'index 0000000..1234567 100644',
    '--- a/src/auth.ts',
    '+++ b/src/auth.ts',
    '@@ -10,6 +10,26 @@',
    ' import { User } from "./types";',
    ' ',
    '+/**',
    '+ * Validate that a user object has the required fields.',
    '+ *',
    '+ * @param user - The user object to validate.',
    '+ * @returns true if valid, false otherwise.',
    '+ */',
    '+export function validateUser(user: unknown): user is User {',
    '+  if (user === null || typeof user !== "object") {',
    '+    return false;',
    '+  }',
    '+  const u = user as Record<string, unknown>;',
    '+  if (typeof u.id !== "string" || u.id.trim() === "") {',
    '+    return false;',
    '+  }',
    '+  if (typeof u.email !== "string" || !u.email.includes("@")) {',
    '+    return false;',
    '+  }',
    '+  return true;',
    '+}',
    ' ',
    ' export function authenticate(token: string): User | null {',
  ].join('\n');

  // ---------------------------------------------------------------------------
  // Build minimal Layer2Result
  // ---------------------------------------------------------------------------
  const layer2: Layer2Result = {
    high_confidence: [],
    medium_confidence: candidates,
    low_confidence: [],
    similarity_scores: {},
    cache_hits: 0,
    cache_misses: 0,
    api_cost_usd: 0,
    processing_time_ms: 0,
  };

  // ---------------------------------------------------------------------------
  // Build SelectorConfig matching DEFAULT_CONFIG but with mode: 'standard'
  // ---------------------------------------------------------------------------
  const config: SelectorConfig = {
    mode: 'standard',
    testRunner: 'auto',
    testDir: '__tests__',
    runAllTestsOn: [
      'package.json',
      'requirements.txt',
      '*.config.ts',
      '.env*',
      '.github/workflows/**',
    ],
    alwaysRun: [],
    neverRun: [],
    architectureNotes: '',
    flakyTestThreshold: 0.15,
    flakyTestQuarantine: 0.40,
    fullSuiteEvery: 50,
  };

  // ---------------------------------------------------------------------------
  // Call classifyWithLLM
  // ---------------------------------------------------------------------------
  console.log(`Candidates (${candidates.length}):`);
  candidates.forEach((c) => console.log(`  - ${c}`));
  console.log(`\nDiff lines: ${diff.split('\n').length}`);
  console.log('\nCalling classifyWithLLM()...\n');

  const result: Layer4Result = await classifyWithLLM(candidates, diff, layer2, config);

  console.log('Layer4Result:');
  console.log(JSON.stringify(result, null, 2));
  console.log('');

  // ---------------------------------------------------------------------------
  // Assertions on Layer4Result
  // ---------------------------------------------------------------------------
  console.log('--- Layer4Result assertions ---');
  assert(result !== null, 'classifyWithLLM() returned non-null');
  assert(result.fallback_used === false, `fallback_used === false (got: ${result.fallback_used})`);
  assert(
    result.decisions.length > 0,
    `decisions.length > 0 (got: ${result.decisions.length})`,
  );

  if (result.decisions.length > 0) {
    assert(
      result.decisions[0].reasoning.length > 0,
      `decisions[0].reasoning is non-empty (length: ${result.decisions[0].reasoning.length})`,
    );
  }

  assert(
    result.llm_calls_made >= 1,
    `llm_calls_made >= 1 (got: ${result.llm_calls_made})`,
  );

  // ---------------------------------------------------------------------------
  // Assertions on classifyDiffType
  // ---------------------------------------------------------------------------
  console.log('\n--- classifyDiffType assertions ---');
  const diffType = classifyDiffType(diff);
  const validTypes: string[] = ['feature', 'bugfix', 'unknown'];
  assert(
    validTypes.includes(diffType),
    `classifyDiffType returns valid type (got: "${diffType}")`,
  );
  console.log(`  Diff classified as: "${diffType}"`);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  if (result.decisions.length > 0) {
    console.log('\n--- Decision details ---');
    result.decisions.forEach((d, i) => {
      console.log(`  [${i}] ${d.test_path}`);
      console.log(`      classification : ${d.classification}`);
      console.log(`      confidence     : ${d.confidence}`);
      console.log(`      reasoning      : ${d.reasoning}`);
    });
  }

  console.log('\n--- Metrics ---');
  console.log(`  llm_calls_made     : ${result.llm_calls_made}`);
  console.log(`  total_tokens_used  : ${result.total_tokens_used}`);
  console.log(`  cost_usd           : $${result.cost_usd.toFixed(8)}`);
  console.log(`  processing_time_ms : ${result.processing_time_ms}`);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
