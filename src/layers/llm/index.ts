// src/layers/llm/index.ts
// Public entry point for the LLM classification layer (Layer 4).
//
// classifyWithLLM() wires together:
//   • decomposeAndClassify  — enriches large diffs with structured context
//   • buildPrompt / buildRetryPrompt — constructs LLM input strings
//   • callLLM               — model-agnostic API call (fail-open)
//   • JSON parse + one retry loop
//   • Conservative mode 3-pass consensus with most-conservative union

import { callLLM } from './client';
import { buildSystemPrompt, buildPrompt, buildRetryPrompt } from './prompt';
import { decomposeAndClassify } from './decomposer';
import type {
  Layer4Result,
  Layer2Result,
  SelectorConfig,
  LLMResponse,
} from '../../../shared/types';

// ---------------------------------------------------------------------------
// Module-private types
// ---------------------------------------------------------------------------

interface ParsedDecision {
  test_path: string;
  classification: 'blocking' | 'recommended' | 'skip';
  confidence: number;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

function emptyLayer4(fallback = true): Layer4Result {
  return {
    decisions: [],
    llm_calls_made: 0,
    total_tokens_used: 0,
    cost_usd: 0,
    fallback_used: fallback,
    processing_time_ms: 0,
  };
}

function parseDecisions(raw: string): ParsedDecision[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as { decisions?: unknown }).decisions)
    ) {
      return null;
    }
    const decisions = (parsed as { decisions: unknown[] }).decisions;
    const validClassifications = new Set(['blocking', 'recommended', 'skip']);
    for (const item of decisions) {
      if (
        item === null ||
        typeof item !== 'object' ||
        typeof (item as Record<string, unknown>).test_path !== 'string' ||
        !validClassifications.has((item as Record<string, unknown>).classification as string) ||
        typeof (item as Record<string, unknown>).confidence !== 'number' ||
        typeof (item as Record<string, unknown>).reasoning !== 'string'
      ) {
        return null;
      }
    }
    return decisions as ParsedDecision[];
  } catch {
    return null;
  }
}

function interleavePermutation(arr: string[]): string[] {
  const evens = arr.filter((_, i) => i % 2 === 0);
  const odds = arr.filter((_, i) => i % 2 !== 0);
  return [...evens, ...odds];
}

const classificationRank: Record<string, number> = {
  blocking: 2,
  recommended: 1,
  skip: 0,
};

// ---------------------------------------------------------------------------
// Internal single-pass runner
// ---------------------------------------------------------------------------

interface Totals {
  llm_calls_made: number;
  total_tokens_used: number;
  cost_usd: number;
}

async function runSinglePass(
  candidates: string[],
  diff: string,
  enrichedNotes: string,
  totals: Totals,
): Promise<ParsedDecision[] | null> {
  const prompt = buildPrompt(candidates, diff, enrichedNotes);
  const r1: LLMResponse | null = await callLLM(prompt, buildSystemPrompt());

  if (r1 !== null) {
    totals.llm_calls_made++;
    totals.total_tokens_used += r1.tokens_used;
    totals.cost_usd += r1.cost_usd;
  }

  const parsed = parseDecisions(r1?.response ?? '');
  if (parsed !== null) {
    return parsed;
  }

  // First parse failed or r1 was null — attempt one retry
  const retryPrompt = buildRetryPrompt(candidates, diff, r1?.response ?? '', enrichedNotes);
  const r2: LLMResponse | null = await callLLM(retryPrompt, buildSystemPrompt());

  if (r2 !== null) {
    totals.llm_calls_made++;
    totals.total_tokens_used += r2.tokens_used;
    totals.cost_usd += r2.cost_usd;
  }

  return parseDecisions(r2?.response ?? '');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify medium-confidence test candidates against the given diff using an LLM.
 *
 * - Small diffs (≤100 effective lines): single-pass (or 3-pass if Conservative).
 * - Large diffs (>100 effective lines): decomposer enriches notes before classification.
 * - Conservative mode: runs 3 passes with different orderings, then takes the
 *   most-conservative (highest-rank) classification for each test_path.
 * - Returns fallback_used:true when all LLM calls fail (fail-open — never throws).
 */
export async function classifyWithLLM(
  candidates: string[],
  diff: string,
  layer2: Layer2Result,
  config: SelectorConfig,
): Promise<Layer4Result> {
  void layer2; // threaded through for future use — not consumed in this slice

  const t0 = Date.now();

  // Short-circuit for empty candidates — no LLM calls needed
  if (candidates.length === 0) {
    return { ...emptyLayer4(false), processing_time_ms: Date.now() - t0 };
  }

  // Run decomposer — may make up to 3 LLM calls for large diffs
  const decomposed = await decomposeAndClassify(candidates, diff, config.architectureNotes);

  // Enrich architecture notes with decomposer context if decomposition ran
  const enrichedNotes = decomposed.decomposed
    ? `[DECOMPOSED DIFF CONTEXT]\n${decomposed.contextSummary}\n${config.architectureNotes ?? ''}`.trimEnd()
    : (config.architectureNotes ?? '');

  // Initialize totals with decomposer metrics (always included)
  const totals: Totals = {
    llm_calls_made: decomposed.llm_calls_made,
    total_tokens_used: decomposed.tokens_used,
    cost_usd: decomposed.cost_usd,
  };

  // ---------------------------------------------------------------------------
  // Conservative path: 3 passes with different orderings, most-conservative wins
  // ---------------------------------------------------------------------------

  if (config.mode === 'conservative') {
    const sorted = [...candidates].sort();
    const pass0 = sorted;
    const pass1 = [...sorted].reverse();
    const pass2 = interleavePermutation(sorted);

    const result0 = await runSinglePass(pass0, diff, enrichedNotes, totals);
    const result1 = await runSinglePass(pass1, diff, enrichedNotes, totals);
    const result2 = await runSinglePass(pass2, diff, enrichedNotes, totals);

    // Union: most-conservative classification wins for each test_path
    const unionMap = new Map<string, ParsedDecision>();

    for (const passResult of [result0, result1, result2]) {
      if (passResult === null) continue;
      for (const decision of passResult) {
        const existing = unionMap.get(decision.test_path);
        if (
          existing === undefined ||
          classificationRank[decision.classification] > classificationRank[existing.classification]
        ) {
          unionMap.set(decision.test_path, decision);
        }
      }
    }

    if (unionMap.size === 0) {
      return {
        ...emptyLayer4(true),
        llm_calls_made: totals.llm_calls_made,
        total_tokens_used: totals.total_tokens_used,
        cost_usd: totals.cost_usd,
        processing_time_ms: Date.now() - t0,
      };
    }

    return {
      decisions: Array.from(unionMap.values()),
      llm_calls_made: totals.llm_calls_made,
      total_tokens_used: totals.total_tokens_used,
      cost_usd: totals.cost_usd,
      fallback_used: false,
      processing_time_ms: Date.now() - t0,
    };
  }

  // ---------------------------------------------------------------------------
  // Non-Conservative path (standard / shadow / aggressive): single pass
  // ---------------------------------------------------------------------------

  const sorted = [...candidates].sort();
  const result = await runSinglePass(sorted, diff, enrichedNotes, totals);

  if (result !== null) {
    return {
      decisions: result,
      llm_calls_made: totals.llm_calls_made,
      total_tokens_used: totals.total_tokens_used,
      cost_usd: totals.cost_usd,
      fallback_used: false,
      processing_time_ms: Date.now() - t0,
    };
  }

  return {
    ...emptyLayer4(true),
    llm_calls_made: totals.llm_calls_made,
    total_tokens_used: totals.total_tokens_used,
    cost_usd: totals.cost_usd,
    processing_time_ms: Date.now() - t0,
  };
}
