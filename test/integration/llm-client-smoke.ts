#!/usr/bin/env npx ts-node
// test/integration/llm-client-smoke.ts
// Integration smoke test for callLLM() — exercises the real Anthropic (primary)
// or OpenAI (fallback) API and validates the LLMResponse shape.
//
// Assertions:
//   1. callLLM() returns non-null (at least one API key is available)
//   2. tokens_used > 0
//   3. cost_usd > 0
//   4. response is a non-empty string
//   5. model is a non-empty string (confirms which provider answered)
//
// Usage:
//   ANTHROPIC_API_KEY=<key> npx ts-node test/integration/llm-client-smoke.ts
//   OPENAI_API_KEY=<key>    npx ts-node test/integration/llm-client-smoke.ts

import { callLLM } from '../../src/layers/llm/client';
import type { LLMResponse } from '../../shared/types';

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

  console.log('=== llm-client-smoke: integration test for callLLM() ===\n');

  // Preflight: warn if neither key is set
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error(
      'ERROR: Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set. ' +
        'At least one key is required to run this smoke test.',
    );
    process.exit(1);
  }

  const prompt = 'Reply with exactly the JSON object: {"status":"ok"}';
  const systemPrompt = 'You are a minimal test assistant. Follow instructions exactly.';

  console.log(`Prompt  : ${prompt}`);
  console.log(`System  : ${systemPrompt}`);
  console.log('');
  console.log('Calling callLLM()...');

  const result: LLMResponse | null = await callLLM(prompt, systemPrompt);

  console.log('');
  console.log('Result:');
  console.log(JSON.stringify(result, null, 2));
  console.log('');

  // Assertions
  assert(result !== null, 'callLLM() returned non-null (at least one provider answered)');

  if (result !== null) {
    assert(result.tokens_used > 0, `tokens_used > 0 (got: ${result.tokens_used})`);
    assert(result.cost_usd > 0, `cost_usd > 0 (got: ${result.cost_usd})`);
    assert(
      typeof result.response === 'string' && result.response.length > 0,
      `response is a non-empty string (length: ${result.response.length})`,
    );
    assert(
      typeof result.model === 'string' && result.model.length > 0,
      `model is a non-empty string (got: "${result.model}")`,
    );

    console.log('');
    console.log(`Model responded : ${result.model}`);
    console.log(`Tokens used     : ${result.tokens_used}`);
    console.log(`Cost (USD)      : $${result.cost_usd.toFixed(8)}`);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
