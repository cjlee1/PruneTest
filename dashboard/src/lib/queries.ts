import { chClient } from './clickhouse'

export interface ShadowProgress {
  run_count: number
  avg_skip_pct: number
}

export interface FlakyRow {
  test_path: string
  flake_score: number
  total_runs: number
}

export interface AccuracyRow {
  week: string
  runs_with_failures: number
  missed_failures: number
  total_failures: number
}

export interface SavingsRow {
  week: string
  minutes_saved: number
}

export interface RecentRunRow {
  pr_number: number
  sha: string
  mode: string
  created_at: string
  skip_pct: number
  failure_count: number
}

/**
 * Returns aggregate shadow-mode progress for a repo: total run count and average
 * fraction of tests predicted to skip.
 * Fails open — returns zeroed struct on any ClickHouse error.
 */
export async function getShadowProgress(repoId: string): Promise<ShadowProgress> {
  try {
    const result = await chClient.query({
      query: `SELECT count() AS run_count,
  avg(length(predicted_skip) / greatest(length(all_tests), 1)) AS avg_skip_pct
FROM runs FINAL WHERE repo_id = {repo_id:String}`,
      query_params: { repo_id: repoId },
      format: 'JSONEachRow',
    })
    const rows = await result.json<{ run_count: unknown; avg_skip_pct: unknown }>()
    if (rows.length === 0) return { run_count: 0, avg_skip_pct: 0 }
    const row = rows[0]
    return {
      run_count: Number(row.run_count),
      avg_skip_pct: Number(row.avg_skip_pct),
    }
  } catch (err) {
    console.error('[queries] getShadowProgress error:', err)
    return { run_count: 0, avg_skip_pct: 0 }
  }
}

/**
 * Returns the flaky-test leaderboard for a repo: tests ordered by flake score desc.
 * Only includes tests with more than 5 total runs.
 * Fails open — returns [] on any ClickHouse error.
 */
export async function getFlakyLeaderboard(repoId: string): Promise<FlakyRow[]> {
  try {
    const result = await chClient.query({
      query: `SELECT test_path, countIf(is_failure) / count() AS flake_score, count() AS total_runs
FROM (
  SELECT arrayJoin(all_tests) AS test_path, 0 AS is_failure
  FROM runs FINAL WHERE repo_id = {repo_id:String}
  UNION ALL
  SELECT arrayJoin(actual_failures) AS test_path, 1 AS is_failure
  FROM runs FINAL WHERE repo_id = {repo_id:String}
)
GROUP BY test_path HAVING count() > 5 ORDER BY flake_score DESC LIMIT 50`,
      query_params: { repo_id: repoId },
      format: 'JSONEachRow',
    })
    const rows = await result.json<{ test_path: unknown; flake_score: unknown; total_runs: unknown }>()
    return rows.map((row) => ({
      test_path: String(row.test_path),
      flake_score: Number(row.flake_score),
      total_runs: Number(row.total_runs),
    }))
  } catch (err) {
    console.error('[queries] getFlakyLeaderboard error:', err)
    return []
  }
}

/**
 * Returns weekly accuracy trend for a repo: runs with failures, missed failures,
 * and total failures per week.
 * Fails open — returns [] on any ClickHouse error.
 */
export async function getAccuracyTrend(repoId: string): Promise<AccuracyRow[]> {
  try {
    const result = await chClient.query({
      query: `SELECT toStartOfWeek(created_at) AS week,
  countIf(length(actual_failures) > 0) AS runs_with_failures,
  sumIf(length(arrayFilter(f -> has(predicted_skip, f), actual_failures)), length(actual_failures) > 0) AS missed_failures,
  sumIf(length(actual_failures), length(actual_failures) > 0) AS total_failures
FROM runs FINAL WHERE repo_id = {repo_id:String}
GROUP BY week ORDER BY week`,
      query_params: { repo_id: repoId },
      format: 'JSONEachRow',
    })
    const rows = await result.json<{
      week: unknown
      runs_with_failures: unknown
      missed_failures: unknown
      total_failures: unknown
    }>()
    return rows.map((row) => ({
      week: String(row.week),
      runs_with_failures: Number(row.runs_with_failures),
      missed_failures: Number(row.missed_failures),
      total_failures: Number(row.total_failures),
    }))
  } catch (err) {
    console.error('[queries] getAccuracyTrend error:', err)
    return []
  }
}

export interface RecallResult {
  recall: number
  total_failures: number
}

/**
 * Returns the recall metric for the last N runs of a repo:
 * recall = (total_failures - missed) / total_failures
 * where missed = failures in actual_failures that were also in predicted_skip.
 * Fails open — returns { recall: 1.0, total_failures: 0 } on any ClickHouse error.
 */
export async function getRecentRecall(repoId: string, n = 20): Promise<RecallResult> {
  try {
    const result = await chClient.query({
      query: `SELECT
  sum(length(arrayFilter(f -> has(predicted_skip, f), actual_failures))) AS missed,
  sum(length(actual_failures)) AS total_failures
FROM (
  SELECT predicted_skip, actual_failures
  FROM runs FINAL
  WHERE repo_id = {repo_id:String}
  ORDER BY created_at DESC
  LIMIT {n:UInt32}
)`,
      query_params: { repo_id: repoId, n },
      format: 'JSONEachRow',
    })
    const rows = await result.json<{ missed: unknown; total_failures: unknown }>()
    if (rows.length === 0) return { recall: 1.0, total_failures: 0 }
    const row = rows[0]
    const missed = Number(row.missed)
    const total = Number(row.total_failures)
    const recall = total > 0 ? (total - missed) / total : 1.0
    return { recall, total_failures: total }
  } catch (err) {
    console.error('[queries] getRecentRecall error:', err)
    return { recall: 1.0, total_failures: 0 }
  }
}

/**
 * Returns weekly savings trend for a repo: total minutes saved per week.
 * Fails open — returns [] on any ClickHouse error.
 */
export async function getSavingsTrend(repoId: string): Promise<SavingsRow[]> {
  try {
    const result = await chClient.query({
      query: `SELECT toStartOfWeek(created_at) AS week, SUM(time_saved_minutes) AS minutes_saved
FROM runs FINAL WHERE repo_id = {repo_id:String}
GROUP BY week ORDER BY week`,
      query_params: { repo_id: repoId },
      format: 'JSONEachRow',
    })
    const rows = await result.json<{ week: unknown; minutes_saved: unknown }>()
    return rows.map((row) => ({
      week: String(row.week),
      minutes_saved: Number(row.minutes_saved),
    }))
  } catch (err) {
    console.error('[queries] getSavingsTrend error:', err)
    return []
  }
}

/**
 * Returns the N most recent run rows for a repo, ordered by created_at desc.
 * Fails open — returns [] on any ClickHouse error.
 */
export async function getRecentRuns(repoId: string, n = 10): Promise<RecentRunRow[]> {
  try {
    const result = await chClient.query({
      query: `SELECT pr_number,
       sha,
       mode,
       created_at,
       length(predicted_skip) / greatest(length(all_tests), 1) AS skip_pct,
       length(actual_failures) AS failure_count
FROM runs FINAL
WHERE repo_id = {repo_id:String}
ORDER BY created_at DESC
LIMIT {n:UInt32}`,
      query_params: { repo_id: repoId, n },
      format: 'JSONEachRow',
    })
    const rows = await result.json<{
      pr_number: unknown; sha: unknown; mode: unknown;
      created_at: unknown; skip_pct: unknown; failure_count: unknown
    }>()
    return rows.map((row) => ({
      pr_number: Number(row.pr_number),
      sha: String(row.sha),
      mode: String(row.mode),
      created_at: String(row.created_at),
      skip_pct: Number(row.skip_pct),
      failure_count: Number(row.failure_count),
    }))
  } catch (err) {
    console.error('[queries] getRecentRuns error:', err)
    return []
  }
}
