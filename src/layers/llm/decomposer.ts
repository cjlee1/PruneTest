// src/layers/llm/decomposer.ts
// Subtask decomposition for large diffs.
// When a diff exceeds DECOMPOSE_THRESHOLD effective +/- lines, runs a 3-stage
// LLM pipeline to extract structured context (files, functions, logic summary)
// and enriches the final classification prompt with that context.
// Degrades gracefully (fail-open) when any stage returns null.

import { callLLM } from './client';
import type { LLMResponse } from '../../../shared/types';
import { buildPrompt } from './prompt';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DECOMPOSE_THRESHOLD = 100;

const DECOMPOSE_SYSTEM_PROMPT = 'You are a code analysis assistant. Answer concisely.';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface DecomposerOutput {
  prompt: string;
  contextSummary: string;
  decomposed: boolean;
  llm_calls_made: number;
  tokens_used: number;
  cost_usd: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Count effective lines in a unified diff.
 * Effective lines start with `+` or `-` but are NOT `+++` or `---`.
 * Mirrors the truncateDiff logic in prompt.ts (per D040).
 */
function countEffectiveLines(diff: string): number {
  if (!diff) return 0;
  let count = 0;
  for (const line of diff.split('\n')) {
    if (
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---')
    ) {
      count++;
    }
  }
  return count;
}

/**
 * Accumulate tokens and cost from a non-null LLMResponse into running totals.
 */
function accumulate(
  response: LLMResponse | null,
  totals: { tokens_used: number; cost_usd: number; llm_calls_made: number },
): void {
  if (response !== null) {
    totals.tokens_used += response.tokens_used;
    totals.cost_usd += response.cost_usd;
    totals.llm_calls_made += 1;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify test candidates against a diff.
 *
 * If the diff has ≤ DECOMPOSE_THRESHOLD effective lines, builds and returns
 * the standard classification prompt immediately (no LLM calls).
 *
 * If the diff exceeds DECOMPOSE_THRESHOLD effective lines, runs a 3-stage
 * pipeline to extract structured context, then enriches the prompt:
 *   Stage 1: extract file paths changed
 *   Stage 2: extract function/method names changed
 *   Stage 3: summarize the logic change in one sentence
 *
 * Every stage degrades to a safe fallback string on null/empty response.
 */
export async function decomposeAndClassify(
  candidates: string[],
  diff: string,
  architectureNotes?: string,
): Promise<DecomposerOutput> {
  const effectiveLines = countEffectiveLines(diff);

  // --- Non-decomposed path ---
  if (effectiveLines <= DECOMPOSE_THRESHOLD) {
    return {
      prompt: buildPrompt(candidates, diff, architectureNotes),
      contextSummary: '',
      decomposed: false,
      llm_calls_made: 0,
      tokens_used: 0,
      cost_usd: 0,
    };
  }

  // --- Decomposed path ---
  const totals = { tokens_used: 0, cost_usd: 0, llm_calls_made: 0 };

  // Stage 1: files changed
  const stage1Prompt =
    `## Code Diff\n${diff}\n\nList the source file paths that are meaningfully changed in this diff. Output a comma-separated list, nothing else.`;
  const stage1Response = await callLLM(stage1Prompt, DECOMPOSE_SYSTEM_PROMPT);
  accumulate(stage1Response, totals);
  const stage1Output =
    stage1Response && stage1Response.response.trim()
      ? stage1Response.response.trim()
      : 'unknown';

  // Stage 2: functions changed
  const stage2Prompt =
    `## Files Changed\n${stage1Output}\n\n## Code Diff\n${diff}\n\nList the function or method names that were changed. Output a comma-separated list, nothing else.`;
  const stage2Response = await callLLM(stage2Prompt, DECOMPOSE_SYSTEM_PROMPT);
  accumulate(stage2Response, totals);
  const stage2Output =
    stage2Response && stage2Response.response.trim()
      ? stage2Response.response.trim()
      : 'unknown';

  // Stage 3: logic summary
  const stage3Prompt =
    `## Files Changed\n${stage1Output}\n\n## Functions Changed\n${stage2Output}\n\n## Code Diff\n${diff}\n\nDescribe in one sentence what specific behavior or logic was changed.`;
  const stage3Response = await callLLM(stage3Prompt, DECOMPOSE_SYSTEM_PROMPT);
  accumulate(stage3Response, totals);
  const stage3Output =
    stage3Response && stage3Response.response.trim()
      ? stage3Response.response.trim()
      : 'a logic change was detected';

  // Build enriched architectureNotes for Stage 4 (final classification prompt)
  const decomposedContext =
    `[DECOMPOSED DIFF CONTEXT]\nFiles changed: ${stage1Output}\nFunctions changed: ${stage2Output}\nLogic change: ${stage3Output}`;
  const enrichedNotes =
    architectureNotes && architectureNotes.trim().length > 0
      ? `${decomposedContext}\n${architectureNotes.trim()}`
      : decomposedContext;

  const contextSummary = `${stage1Output}\n${stage2Output}\n${stage3Output}`;

  return {
    prompt: buildPrompt(candidates, diff, enrichedNotes),
    contextSummary,
    decomposed: true,
    llm_calls_made: totals.llm_calls_made,
    tokens_used: totals.tokens_used,
    cost_usd: totals.cost_usd,
  };
}
