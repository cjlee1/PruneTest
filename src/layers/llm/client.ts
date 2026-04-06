// src/layers/llm/client.ts
// Model-agnostic LLM client.
// Primary: Anthropic Claude Haiku. Fallback: OpenAI GPT-4o-mini.
// Returns null on total failure (fail-open per AGENTS.md rule 1).

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LLMResponse } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Pricing constants (per-token, USD)
// ---------------------------------------------------------------------------

// claude-haiku-3-5 pricing: $0.80 input / $4.00 output per 1M tokens
const ANTHROPIC_INPUT_COST_PER_TOKEN = 0.0000008;   // $0.80 / 1_000_000
const ANTHROPIC_OUTPUT_COST_PER_TOKEN = 0.000004;   // $4.00 / 1_000_000

// gpt-4o-mini pricing: $0.15 input / $0.60 output per 1M tokens
const OPENAI_INPUT_COST_PER_TOKEN = 0.00000015;     // $0.15 / 1_000_000
const OPENAI_OUTPUT_COST_PER_TOKEN = 0.0000006;     // $0.60 / 1_000_000

const ANTHROPIC_MODEL = 'claude-haiku-4-5' as const;
const OPENAI_MODEL = 'gpt-4o-mini' as const;
const MAX_TOKENS = 1024;

// ---------------------------------------------------------------------------
// Anthropic attempt
// ---------------------------------------------------------------------------

async function callAnthropic(
  prompt: string,
  systemPrompt: string,
  apiKey: string,
): Promise<LLMResponse> {
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  // Extract text content — Anthropic returns an array of content blocks
  const textBlock = message.content.find((b) => b.type === 'text');
  const responseText = textBlock && textBlock.type === 'text' ? textBlock.text : '';

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;
  const tokensUsed = inputTokens + outputTokens;
  const costUsd =
    inputTokens * ANTHROPIC_INPUT_COST_PER_TOKEN +
    outputTokens * ANTHROPIC_OUTPUT_COST_PER_TOKEN;

  return {
    prompt,
    response: responseText,
    tokens_used: tokensUsed,
    cost_usd: costUsd,
    model: ANTHROPIC_MODEL,
  };
}

// ---------------------------------------------------------------------------
// OpenAI attempt
// ---------------------------------------------------------------------------

async function callOpenAI(
  prompt: string,
  systemPrompt: string,
  apiKey: string,
): Promise<LLMResponse> {
  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
  });

  const responseText = completion.choices[0]?.message?.content ?? '';

  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  const tokensUsed = inputTokens + outputTokens;
  const costUsd =
    inputTokens * OPENAI_INPUT_COST_PER_TOKEN +
    outputTokens * OPENAI_OUTPUT_COST_PER_TOKEN;

  return {
    prompt,
    response: responseText,
    tokens_used: tokensUsed,
    cost_usd: costUsd,
    model: OPENAI_MODEL,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Call an LLM with the given prompt and system prompt.
 *
 * Attempts Anthropic Claude Haiku first; falls back to OpenAI GPT-4o-mini
 * on any failure; returns null if both fail (fail-open — never throws).
 *
 * API keys are read from environment variables:
 *   ANTHROPIC_API_KEY  — required for primary model
 *   OPENAI_API_KEY     — required for fallback model
 */
export async function callLLM(
  prompt: string,
  systemPrompt: string,
): Promise<LLMResponse | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? '';
  const openaiKey = process.env.OPENAI_API_KEY ?? '';

  // --- Primary: Anthropic ---
  if (anthropicKey) {
    try {
      return await callAnthropic(prompt, systemPrompt, anthropicKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[LLM] Anthropic primary call failed: ${msg}. Trying OpenAI fallback.`);
    }
  } else {
    console.warn('[LLM] ANTHROPIC_API_KEY not set. Skipping primary model.');
  }

  // --- Fallback: OpenAI ---
  if (openaiKey) {
    try {
      return await callOpenAI(prompt, systemPrompt, openaiKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[LLM] OpenAI fallback call failed: ${msg}.`);
    }
  } else {
    console.warn('[LLM] OPENAI_API_KEY not set. Skipping fallback model.');
  }

  // --- Total failure ---
  console.warn('[LLM] Both primary and fallback models failed. Returning null.');
  return null;
}
