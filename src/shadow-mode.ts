// src/shadow-mode.ts
// Shadow mode engine: run record I/O, accuracy reporting, backstop, test result parsing.
//
// Iron rule: fail-open always. Every function catches its own errors,
// logs a warning, and returns a safe default. Never throw.

import * as fs from 'fs'
import * as path from 'path'
import { exec } from '@actions/exec'
import type { RunRecord } from '../shared/types'

/**
 * Load run records from a JSONL file.
 * Each line is a JSON-serialized RunRecord with created_at as an ISO string.
 * Fail-open: file not found or any error → return [].
 */
export function loadRunRecords(filePath: string): RunRecord[] {
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch (err) {
    process.stderr.write(
      `[shadow-mode] loadRunRecords: cannot read '${filePath}': ${String(err)}\n`,
    )
    return []
  }

  const lines = content.split('\n').filter((line) => line.trim() !== '')
  const records: RunRecord[] = []

  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i])
      parsed.created_at = new Date(parsed.created_at)
      records.push(parsed as RunRecord)
    } catch (err) {
      process.stderr.write(
        `[shadow-mode] loadRunRecords: skipping malformed line ${i + 1}: ${String(err)}\n`,
      )
    }
  }

  return records
}

/**
 * Append a single RunRecord as a JSONL line.
 * Creates parent directories if absent. Fail-open: errors logged, never thrown.
 */
export function appendRunRecord(filePath: string, record: RunRecord): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const serialized = JSON.stringify({
      ...record,
      created_at: record.created_at.toISOString(),
    })
    fs.appendFileSync(filePath, serialized + '\n')
  } catch (err) {
    process.stderr.write(
      `[shadow-mode] appendRunRecord error: ${String(err)}\n`,
    )
  }
}

/**
 * Commit the run records file via git add/commit/push.
 * Uses @actions/exec for proper GitHub Actions environment handling.
 * Fail-open: any exec failure → warn + return.
 */
export async function commitRunRecords(
  workspaceDir: string,
  filePath: string,
): Promise<void> {
  try {
    const opts = { cwd: workspaceDir }
    await exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], opts)
    await exec('git', ['config', 'user.name', 'github-actions[bot]'], opts)
    await exec('git', ['add', filePath], opts)
    await exec('git', ['commit', '-m', 'chore: update run records [skip ci]'], opts)
    await exec('git', ['push'], opts)
  } catch (err) {
    console.warn(`[shadow-mode] commitRunRecords error: ${String(err)}`)
  }
}

/**
 * Generate an accuracy report string from run history.
 * Computes average skip percentage and recall (fraction of real failures caught).
 */
export function generateAccuracyReport(runs: RunRecord[]): string {
  if (runs.length === 0) {
    return 'No run history available.'
  }

  let skipPctSum = 0
  let validRunCount = 0
  let totalActualFailures = 0
  let missedFailures = 0

  for (const run of runs) {
    if (run.all_tests.length > 0) {
      skipPctSum += run.predicted_skip.length / run.all_tests.length
      validRunCount++
    }

    totalActualFailures += run.actual_failures.length

    // Missed failures = tests that were in predicted_skip AND in actual_failures
    const skipSet = new Set(run.predicted_skip)
    for (const failure of run.actual_failures) {
      if (skipSet.has(failure)) {
        missedFailures++
      }
    }
  }

  const skipPct = validRunCount > 0 ? skipPctSum / validRunCount : 0
  const recall =
    totalActualFailures === 0
      ? 1.0
      : (totalActualFailures - missedFailures) / totalActualFailures

  return `Over the last ${runs.length} PRs, we would have skipped ${(skipPct * 100).toFixed(1)}% of tests and caught ${(recall * 100).toFixed(1)}% of failures.`
}

/**
 * Check whether the backstop should fire (force full suite every N PRs).
 * Returns true when runCount is a positive multiple of fullSuiteEvery.
 */
export function checkBackstop(
  runCount: number,
  fullSuiteEvery: number,
): boolean {
  return runCount > 0 && runCount % fullSuiteEvery === 0
}

/**
 * Check whether recall has dropped below the accuracy floor (99%).
 * Returns true only when enough history exists AND recall < 0.99 over the window.
 */
export function checkAccuracyFloor(
  runs: RunRecord[],
  windowSize: number = 20,
): boolean {
  if (runs.length < windowSize) {
    return false
  }

  const window = runs.slice(-windowSize)
  let totalActualFailures = 0
  let missedFailures = 0

  for (const run of window) {
    totalActualFailures += run.actual_failures.length
    const skipSet = new Set(run.predicted_skip)
    for (const failure of run.actual_failures) {
      if (skipSet.has(failure)) {
        missedFailures++
      }
    }
  }

  // No failures in the window → recall is perfect → floor not triggered
  if (totalActualFailures === 0) {
    return false
  }

  const recall = (totalActualFailures - missedFailures) / totalActualFailures
  return recall < 0.99
}

/**
 * Parse a Jest JSON output file and return failing test file paths.
 * Strips the GITHUB_WORKSPACE prefix to produce repo-relative paths.
 * Fail-open: any error → return [].
 */
export function parseJestJson(filePath: string): string[] {
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch (err) {
    process.stderr.write(
      `[shadow-mode] parseJestJson: cannot read '${filePath}': ${String(err)}\n`,
    )
    return []
  }

  let data: { testResults?: Array<{ testFilePath: string; status: string }> }
  try {
    data = JSON.parse(content)
  } catch (err) {
    process.stderr.write(
      `[shadow-mode] parseJestJson: invalid JSON in '${filePath}': ${String(err)}\n`,
    )
    return []
  }

  if (!Array.isArray(data.testResults)) {
    return []
  }

  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()
  const prefix = workspace + '/'

  const failures: string[] = []
  for (const result of data.testResults) {
    if (result.status === 'failed') {
      const raw = result.testFilePath
      const relative = raw.startsWith(prefix)
        ? raw.slice(prefix.length)
        : path.relative(workspace, raw)
      failures.push(relative)
    }
  }

  return failures.sort()
}

/**
 * Compute per-test flake scores from run history.
 * Score = failureCount / totalRunsSeen for each test path.
 */
export function computeFlakeScores(
  runs: RunRecord[],
): Map<string, number> {
  const seen = new Map<string, number>()
  const failed = new Map<string, number>()

  for (const run of runs) {
    for (const test of run.all_tests) {
      seen.set(test, (seen.get(test) ?? 0) + 1)
    }
    for (const test of run.actual_failures) {
      failed.set(test, (failed.get(test) ?? 0) + 1)
    }
  }

  const scores = new Map<string, number>()
  for (const [test, count] of seen) {
    scores.set(test, (failed.get(test) ?? 0) / count)
  }

  return scores
}
