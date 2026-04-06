// src/orchestrator.ts
// Orchestrates Layer 1 → Layer 2 → Layer 3 → Layer 4 in order.
// Each layer is wrapped in a fail-open try/catch: any layer failure produces
// a safe empty result and logs a console.warn so CI logs surface the issue.
//
// L1 is an internal stub until its real implementation lands.
// L2 uses the real matchEmbeddings from src/layers/embeddings/index.ts.
// L3 uses the real scoreWithML from src/layers/ml/index.ts.

import { scoreWithML } from './layers/ml/index';
import { classifyWithLLM } from './layers/llm/index';
import { classifyDiffType } from './layers/llm/pr-classifier';
import { matchEmbeddings } from './layers/embeddings';
import type {
  Layer1Result,
  Layer2Result,
  Layer3Result,
  Layer4Result,
  SelectorConfig,
  RunRecord,
  TestRecord,
} from '../shared/types';

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface OrchestratorResult {
  layer1: Layer1Result;
  layer2: Layer2Result;
  layer3: Layer3Result;
  layer4: Layer4Result;
}

// ---------------------------------------------------------------------------
// Stub safe-defaults
// ---------------------------------------------------------------------------

function emptyLayer1(): Layer1Result {
  return {
    blocking_candidates: [],
    run_full_suite: false,
    dependency_graph: {},
    parsing_errors: [],
    processing_time_ms: 0,
  };
}

function emptyLayer2(): Layer2Result {
  return {
    high_confidence: [],
    medium_confidence: [],
    low_confidence: [],
    similarity_scores: {},
    cache_hits: 0,
    cache_misses: 0,
    api_cost_usd: 0,
    processing_time_ms: 0,
  };
}

function emptyLayer3(candidates: string[]): Layer3Result {
  return {
    ranked_tests: candidates.map((p) => ({ path: p, score: 0.5, features_used: [] })),
    model_version: 'dormant',
    training_runs_available: 0,
    model_active: false,
    processing_time_ms: 0,
  };
}

function emptyLayer4(): Layer4Result {
  return {
    decisions: [],
    llm_calls_made: 0,
    total_tokens_used: 0,
    cost_usd: 0,
    fallback_used: true,
    processing_time_ms: 0,
  };
}

// ---------------------------------------------------------------------------
// Layer stubs (L1) — real implementation lands in a later milestone
// ---------------------------------------------------------------------------

/**
 * Layer 1 stub: structural analysis (import tracing, config detection).
 * Returns an empty result until the real implementation is wired.
 */
function runLayer1Stub(
  changedFiles: string[],
  diff: string,
  config: SelectorConfig,
): Layer1Result {
  void changedFiles; void diff; void config;
  return emptyLayer1();
}

// ---------------------------------------------------------------------------
// Orchestrator entry point
// ---------------------------------------------------------------------------

/**
 * Run the full layer pipeline for a given PR diff.
 *
 * @param changedFiles - Alphabetically sorted list of changed file paths (AGENTS.md rule 4).
 * @param diff         - Raw unified diff string for the PR.
 * @param config       - Parsed SelectorConfig from .testselector.yml.
 * @param runHistory   - Historical run records used by L3 (ML layer).
 * @param tests        - Test metadata records used by L3.
 * @param projectRoot  - Root directory for test file discovery (default: process.cwd()).
 * @returns OrchestratorResult containing all four layer outputs.
 */
export async function runOrchestrator(
  changedFiles: string[],
  diff: string,
  config: SelectorConfig,
  runHistory: RunRecord[],
  tests: TestRecord[],
  projectRoot?: string,
): Promise<OrchestratorResult> {
  // Enforce alphabetical ordering on LLM inputs (AGENTS.md rule 4)
  const sortedFiles = [...changedFiles].sort();

  // --- Layer 1: structural analysis ---
  let layer1: Layer1Result = emptyLayer1();
  try {
    layer1 = runLayer1Stub(sortedFiles, diff, config);
  } catch (err) {
    console.warn(`[orchestrator] Layer 1 error: ${String(err)}. Using empty result.`);
  }

  // --- Layer 2: embedding similarity ---
  let layer2: Layer2Result = emptyLayer2();
  try {
    layer2 = await matchEmbeddings(diff, projectRoot ?? process.cwd(), config, layer1);
  } catch (err) {
    console.warn(`[orchestrator] Layer 2 error: ${String(err)}. Using empty result.`);
  }

  // --- Layer 3: ML scoring (real implementation) ---
  // Candidates are the union of all confidence bands, sorted alphabetically
  const allCandidates = [
    ...layer2.high_confidence,
    ...layer2.medium_confidence,
    ...layer2.low_confidence,
  ].sort();

  let layer3: Layer3Result = emptyLayer3(allCandidates);
  try {
    layer3 = await scoreWithML(allCandidates, layer1, layer2, runHistory, tests);
  } catch (err) {
    console.warn(`[orchestrator] Layer 3 error: ${String(err)}. Using empty result.`);
  }

  // --- Layer 4: LLM semantic classification (medium confidence band only) ---
  let layer4: Layer4Result = emptyLayer4();
  try {
    const sortedCandidates = [...layer2.medium_confidence].sort();
    const prType = classifyDiffType(diff);
    const effectiveMode = (prType === 'feature' && config.mode !== 'conservative')
      ? 'conservative'
      : config.mode;
    const effectiveConfig = effectiveMode !== config.mode
      ? { ...config, mode: effectiveMode as typeof config.mode }
      : config;
    layer4 = await classifyWithLLM(sortedCandidates, diff, layer2, effectiveConfig);
  } catch (err) {
    console.warn(`[orchestrator] Layer 4 error: ${String(err)}. Using empty result.`);
  }

  return { layer1, layer2, layer3, layer4 };
}
