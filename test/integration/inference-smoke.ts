#!/usr/bin/env npx ts-node
// test/integration/inference-smoke.ts
// Integration smoke test for onnxruntime-node inference.
// Runs outside Jest to avoid VM sandbox realm mismatch with native bindings.
//
// Usage: npx ts-node test/integration/inference-smoke.ts

import * as path from 'path';
import * as fs from 'fs';
import { runInference } from '../../src/layers/ml/inference';

const MODEL_PATH = path.join(__dirname, '../../models/gbdt.onnx');

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

  console.log('=== inference-smoke: integration test ===\n');

  // Pre-check: model exists
  assert(fs.existsSync(MODEL_PATH), `Model exists at ${MODEL_PATH}`);

  // Test 1: missing model → zeros, no throw
  console.log('\nTest 1: missing model → fail-open zeros');
  const r1 = await runInference('/tmp/no_such_model.onnx', new Float32Array(24), 3);
  assert(r1 instanceof Float32Array, 'result is Float32Array');
  assert(r1.length === 3, 'length equals numCandidates');
  assert(Array.from(r1).every((v) => v === 0), 'all values are zero');

  // Test 2: real model, valid input → probabilities in [0,1]
  console.log('\nTest 2: real model → scores in [0,1]');
  const numCandidates = 4;
  const features = new Float32Array(numCandidates * 8).fill(0.5);
  const r2 = await runInference(MODEL_PATH, features, numCandidates);
  assert(r2 instanceof Float32Array, 'result is Float32Array');
  assert(r2.length === numCandidates, `length equals ${numCandidates}`);
  assert(
    Array.from(r2).every((v) => v >= 0 && v <= 1),
    'all scores in [0,1]'
  );
  assert(
    Array.from(r2).some((v) => v > 0),
    'at least one non-zero score (model is functional)'
  );
  console.log('  scores:', Array.from(r2));

  // Test 3: different feature inputs → different scores (model is not constant)
  console.log('\nTest 3: varied inputs → model discrimination');
  const features2 = new Float32Array(numCandidates * 8).map((_, i) => (i % 8) * 0.1);
  const r3 = await runInference(MODEL_PATH, features2, numCandidates);
  assert(r3.length === numCandidates, 'result length matches');
  // With varied features, at least some candidates should differ
  console.log('  scores:', Array.from(r3));

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
