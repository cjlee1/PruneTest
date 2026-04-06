// src/layers/ml/features.ts
// Pure-function feature extractor: maps one test candidate to the 8-feature
// Float32Array the ONNX model expects.
//
// Feature index contract (must match ONNX model training order):
//   [0] embedding similarity
//   [1] graph distance (normalized 0-1)
//   [2] historical failure rate
//   [3] days since last failure (normalized 0-1; 1.0 = never failed)
//   [4] flakiness score
//   [5] test execution time (normalized to minutes, capped at 1.0)
//   [6] file churn rate (distinct PRs in last 30 days / 30, capped at 1.0)
//   [7] author defect rate (reserved — always 0.0; RunRecord has no author field)

import type { Layer1Result, Layer2Result, RunRecord, TestRecord } from '../../../shared/types';

const MS_PER_DAY = 86_400_000;
const MAX_GRAPH_DISTANCE = 5;
const MAX_DAYS_SINCE_FAILURE = 365;
const CHURN_WINDOW_MS = 30 * MS_PER_DAY;

/**
 * Compute BFS shortest distance from any changed file (dependency_graph keys)
 * to the candidate via the dependency graph edges.
 *
 * dependency_graph: file → files it imports (outgoing edges).
 * Returns 0 if candidate is not reachable (treat as directly reachable),
 * capped at MAX_GRAPH_DISTANCE.
 */
function graphDistance(
  candidate: string,
  dependencyGraph: Record<string, string[]>
): number {
  const changedFiles = Object.keys(dependencyGraph);
  if (changedFiles.length === 0) return 0;

  const visited = new Set<string>();
  const queue: Array<[string, number]> = changedFiles.map((f) => [f, 0]);
  changedFiles.forEach((f) => visited.add(f));

  while (queue.length > 0) {
    const [node, dist] = queue.shift()!;
    if (node === candidate) {
      return Math.min(dist, MAX_GRAPH_DISTANCE);
    }
    if (dist >= MAX_GRAPH_DISTANCE) continue;
    const neighbors = dependencyGraph[node] ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([neighbor, dist + 1]);
      }
    }
  }

  // Not reachable → treat as distance 0 (directly reachable)
  return 0;
}

export function extractFeatures(
  candidate: string,
  layer1: Layer1Result,
  layer2: Layer2Result,
  runHistory: RunRecord[],
  tests: TestRecord[],
  repoId: string
): Float32Array {
  // [0] Embedding similarity
  const f0 = layer2.similarity_scores[candidate] ?? 0.0;

  // [1] Graph distance (normalized 0-1)
  const rawDist = graphDistance(candidate, layer1.dependency_graph);
  const f1 = rawDist / MAX_GRAPH_DISTANCE;

  // Filter run history to this repo
  const repoRuns = runHistory.filter((r) => r.repo_id === repoId);

  // [2] Historical failure rate
  let f2 = 0.0;
  if (repoRuns.length > 0) {
    const failCount = repoRuns.filter((r) =>
      r.actual_failures.includes(candidate)
    ).length;
    f2 = failCount / repoRuns.length;
  }

  // [3] Days since last failure (normalized; 1.0 = never failed / very stale)
  const lastFailRun = repoRuns
    .filter((r) => r.actual_failures.includes(candidate))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];

  let f3 = 1.0;
  if (lastFailRun) {
    const daysSince =
      (Date.now() - lastFailRun.created_at.getTime()) / MS_PER_DAY;
    f3 = Math.min(daysSince, MAX_DAYS_SINCE_FAILURE) / MAX_DAYS_SINCE_FAILURE;
  }

  // [4] Flakiness score
  const testRecord = tests.find((t) => t.path === candidate);
  const f4 = testRecord?.flake_score ?? 0.0;

  // [5] Test execution time (normalized to minutes, capped at 1.0)
  const f5 = testRecord
    ? Math.min(testRecord.avg_duration_ms / 60_000, 1.0)
    : 0.0;

  // [6] File churn rate: distinct PRs in last 30 days / 30, capped at 1.0
  const cutoff = Date.now() - CHURN_WINDOW_MS;
  const recentPRs = new Set(
    repoRuns
      .filter((r) => r.created_at.getTime() >= cutoff)
      .map((r) => r.pr_number)
  );
  const f6 = Math.min(recentPRs.size / 30, 1.0);

  // [7] Author defect rate — reserved, always 0.0
  const f7 = 0.0;

  return new Float32Array([f0, f1, f2, f3, f4, f5, f6, f7]);
}
