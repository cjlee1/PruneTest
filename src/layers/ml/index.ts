// src/layers/ml/index.ts
// scoreWithML entry point: dormancy gate + feature extraction + ONNX inference.

import * as path from 'path';
import { extractFeatures } from './features';
import { runInference } from './inference';
import type {
  Layer1Result,
  Layer2Result,
  Layer3Result,
  RunRecord,
  TestRecord,
} from '../../../shared/types';

const DORMANCY_THRESHOLD = 100;
const FEATURES_USED = [
  'embedding_similarity',
  'graph_distance',
  'failure_rate',
  'days_since_failure',
  'flakiness',
  'exec_time',
  'file_churn',
  'author_defect_rate',
];

/**
 * Determine the most common repo_id in runHistory.
 * Returns empty string if runHistory is empty.
 */
function mostCommonRepoId(runHistory: RunRecord[]): string {
  if (runHistory.length === 0) return '';
  const counts = new Map<string, number>();
  for (const r of runHistory) {
    counts.set(r.repo_id, (counts.get(r.repo_id) ?? 0) + 1);
  }
  let bestId = '';
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * ML scoring entry point.
 *
 * Returns Layer3Result with model_active:false when:
 *   - fewer than 100 run records exist (dormancy gate)
 *   - the model file is missing or inference fails (fail-open)
 */
export async function scoreWithML(
  candidates: string[],
  layer1: Layer1Result,
  layer2: Layer2Result,
  runHistory: RunRecord[],
  tests: TestRecord[]
): Promise<Layer3Result> {
  const start = Date.now();

  const repoId = mostCommonRepoId(runHistory);
  const repoRuns = runHistory.filter((r) => r.repo_id === repoId).length;

  // --- Dormancy gate ---
  if (repoRuns < DORMANCY_THRESHOLD) {
    return {
      model_active: false,
      ranked_tests: candidates.map((p) => ({
        path: p,
        score: 0.5,
        features_used: [],
      })),
      model_version: 'dormant',
      training_runs_available: repoRuns,
      processing_time_ms: Date.now() - start,
    };
  }

  // --- Feature extraction ---
  if (candidates.length === 0) {
    return {
      model_active: true,
      ranked_tests: [],
      model_version: 'gbdt-v1',
      training_runs_available: repoRuns,
      processing_time_ms: Date.now() - start,
    };
  }

  const flatFeatures = new Float32Array(candidates.length * 8);
  for (let i = 0; i < candidates.length; i++) {
    const vec = extractFeatures(candidates[i], layer1, layer2, runHistory, tests, repoId);
    flatFeatures.set(vec, i * 8);
  }

  // --- ONNX inference ---
  const modelPath = path.join(__dirname, '../../../models/gbdt.onnx');
  const scores = await runInference(modelPath, flatFeatures, candidates.length);

  // Detect fail-open: runInference returns all-zeros on error
  const allZeros = scores.every((s) => s === 0);
  if (allZeros && candidates.length > 0) {
    return {
      model_active: false,
      ranked_tests: candidates.map((p) => ({
        path: p,
        score: 0.5,
        features_used: [],
      })),
      model_version: 'dormant',
      training_runs_available: repoRuns,
      processing_time_ms: Date.now() - start,
    };
  }

  // --- Build ranked_tests sorted descending by score ---
  const ranked = candidates
    .map((p, i) => ({ path: p, score: scores[i], features_used: FEATURES_USED }))
    .sort((a, b) => b.score - a.score);

  return {
    model_active: true,
    ranked_tests: ranked,
    model_version: 'gbdt-v1',
    training_runs_available: repoRuns,
    processing_time_ms: Date.now() - start,
  };
}
