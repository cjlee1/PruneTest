// src/merger.ts
// Merges Layer 1-4 outputs into a single FinalSelection.
//
// Responsibilities:
//   - Blocking list:  union of L1.blocking_candidates + L2.high_confidence
//                     + L4 decisions classified as 'blocking'
//   - Recommended:    L4 decisions classified as 'recommended' (not already blocking)
//   - Skip list:      remaining tests not in blocking/recommended, capped by profile
//   - Shadow mode:    skip list always empty, mode set to 'shadow'
//   - run_full_suite: pass through as comment token; blocking contains all tests
//   - overall_confidence: average of all similarity_scores values (or 0 if none)
//   - total_cost_usd: L2.api_cost_usd + L4.cost_usd
//   - estimated_time_saved_minutes: skip.length × 0.5 minutes per skipped test
//   - pr_comment: placeholder summary string

import type {
  FinalSelection,
  Layer1Result,
  Layer2Result,
  Layer3Result,
  Layer4Result,
  SelectorConfig,
  TestRecord,
} from '../shared/types';
import { SELECTION_PROFILES } from '../shared/types';

/**
 * Merge all four layer outputs into a FinalSelection.
 *
 * @param layer1  - Layer 1 structural analysis result.
 * @param layer2  - Layer 2 embedding similarity result.
 * @param layer3  - Layer 3 ML scoring result (ranked_tests for ordering guidance).
 * @param layer4  - Layer 4 LLM classification result.
 * @param config  - Parsed SelectorConfig (provides mode and profile).
 * @param tests   - All known test records (used to build the full test universe).
 * @returns       A FinalSelection ready for CI output.
 */
export function mergeLayers(
  layer1: Layer1Result,
  layer2: Layer2Result,
  layer3: Layer3Result,
  layer4: Layer4Result,
  config: SelectorConfig,
  tests: TestRecord[],
  flakeScores?: Map<string, number>,
): FinalSelection {
  const mode = config.mode;
  const profile = SELECTION_PROFILES[mode];

  // ── 1. Build blocking set ─────────────────────────────────────────────────
  // Union: L1 blocking_candidates + L2 high_confidence + L4 'blocking' decisions
  const blockingSet = new Set<string>([
    ...layer1.blocking_candidates,
    ...layer2.high_confidence,
    ...layer4.decisions
      .filter((d) => d.classification === 'blocking')
      .map((d) => d.test_path),
  ]);

  // ── 2. run_full_suite passthrough ─────────────────────────────────────────
  // When any layer signals full suite needed, blocking includes everything.
  if (layer1.run_full_suite) {
    for (const t of tests) {
      blockingSet.add(t.path);
    }
  }

  const blocking = [...blockingSet].sort();

  // ── 3. Build recommended set ──────────────────────────────────────────────
  // L4 decisions classified as 'recommended' that aren't already blocking.
  const recommendedSet = new Set<string>(
    layer4.decisions
      .filter((d) => d.classification === 'recommended' && !blockingSet.has(d.test_path))
      .map((d) => d.test_path),
  );
  const recommended = [...recommendedSet].sort();

  // ── 4. Build skip list (with profile cap) ────────────────────────────────
  // Shadow mode: skip is always empty — observe only, never skip anything.
  let skip: string[] = [];
  if (mode !== 'shadow') {
    // Candidates for skipping: tests not in blocking or recommended sets.
    const alreadySelected = new Set<string>([...blockingSet, ...recommendedSet]);
    const skipCandidates = tests
      .map((t) => t.path)
      .filter((p) => !alreadySelected.has(p))
      .sort(); // alphabetical order for determinism

    // Apply profile cap: skip at most skipMaxPercent of all tests.
    const totalTests = tests.length;
    const maxSkip = totalTests > 0 ? Math.floor(profile.skipMaxPercent * totalTests) : 0;
    skip = skipCandidates.slice(0, maxSkip);

    // Quarantine filter: remove flaky tests (score > flakyTestQuarantine) from skip list.
    if (flakeScores && flakeScores.size > 0) {
      skip = skip.filter(p => (flakeScores.get(p) ?? 0) <= config.flakyTestQuarantine);
    }
  }

  // ── 5. Compute overall_confidence ────────────────────────────────────────
  // Average of all similarity_scores values from L2. Defaults to 0 if none.
  const scores = Object.values(layer2.similarity_scores);
  const overallConfidence =
    scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : 0;

  // ── 6. Cost and time-saved estimates ─────────────────────────────────────
  const totalCostUsd = layer2.api_cost_usd + layer4.cost_usd;
  // Rough heuristic: 0.5 minutes saved per skipped test.
  const estimatedTimeSavedMinutes = skip.length * 0.5;

  // ── 7. PR comment placeholder ─────────────────────────────────────────────
  // Real formatting lands when L4's reasoning strings are wired in later milestones.
  const prComment = [
    `[PruneTest] mode=${mode}`,
    `blocking=${blocking.length}`,
    `recommended=${recommended.length}`,
    `skip=${skip.length}`,
    `confidence=${overallConfidence.toFixed(2)}`,
  ].join(' | ');

  // ── 8. Unused L3 parameter — referenced to satisfy lint rules ─────────────
  // L3 ranked_tests will be used for ordering in a future milestone once
  // the real embedding layer provides meaningful similarity scores.
  void layer3;

  return {
    blocking,
    recommended,
    skip,
    mode,
    overall_confidence: overallConfidence,
    pr_comment: prComment,
    total_cost_usd: totalCostUsd,
    estimated_time_saved_minutes: estimatedTimeSavedMinutes,
  };
}
