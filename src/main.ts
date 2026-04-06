// src/main.ts
// Entrypoint for the Skippr GitHub Action.
//
// Iron rule: fail-open always. Any unhandled error → log via core.warning(),
// set safe placeholder outputs, and exit 0. Never call process.exit(1).

import * as crypto from 'crypto'
import * as path from 'path'
import * as core from '@actions/core'
import { generateComment, postPRComment } from './comment'
import { parseConfig } from './config'
import { runOrchestrator } from './orchestrator'
import { mergeLayers } from './merger'
import {
  loadRunRecords,
  appendRunRecord,
  commitRunRecords,
  checkBackstop,
  checkAccuracyFloor,
  parseJestJson,
  generateAccuracyReport,
  computeFlakeScores,
} from './shadow-mode'
import type { RunRecord, TestRecord } from '../shared/types'

/** Placeholder empty-array JSON for all list outputs when pipeline fails. */
const EMPTY_LIST = '[]'

/**
 * Run the action entrypoint.
 * Exported for unit testing.
 */
export async function run(): Promise<void> {
  try {
    // Read inputs
    const configFile = core.getInput('config-file') || '.testselector.yml'
    const modeOverride = core.getInput('mode') || undefined
    const apiKey = core.getInput('api-key') || ''
    if (apiKey && !process.env.ANTHROPIC_API_KEY) {
      process.env.ANTHROPIC_API_KEY = apiKey
    }

    // Load config (fail-open: returns defaults on any IO/parse error)
    const config = parseConfig(configFile)

    // mode input takes precedence over config file value when provided
    if (modeOverride) {
      config.mode = modeOverride as typeof config.mode
    }

    core.info(`[skippr] Loaded config from '${configFile}'. Mode: ${config.mode}`)

    // --- Shadow mode: load run history ---
    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()
    const runHistoryFile = path.join(workspace, '.testselector', 'runs.jsonl')

    let runHistory: RunRecord[] = []
    try {
      runHistory = loadRunRecords(runHistoryFile)
    } catch (e) {
      console.warn('[skippr] Failed to load run history:', e)
    }

    const flakeScores = computeFlakeScores(runHistory)

    // --- Shadow mode: parse test results (if provided) ---
    const testResultsFile = core.getInput('test-results-file') || ''
    let actualFailures: string[] = []
    if (testResultsFile) {
      try {
        actualFailures = parseJestJson(testResultsFile)
      } catch (e) {
        console.warn('[skippr] Failed to parse test results:', e)
      }
    }

    // --- Shadow mode: accuracy floor check (uses historical data BEFORE current run) ---
    if (checkAccuracyFloor(runHistory)) {
      core.warning('[skippr] Accuracy floor triggered — reverting to shadow mode')
      config.mode = 'shadow'
    }

    // --- Shadow mode: backstop check ---
    if (checkBackstop(runHistory.length, config.fullSuiteEvery)) {
      core.info(
        `[skippr] Backstop triggered at run #${runHistory.length} — forcing full suite`,
      )
    }

    // Changed files and diff are not yet wired from GitHub context (future milestone).
    // Use safe empty defaults so the pipeline runs fail-open.
    const changedFiles: string[] = []
    const diff = ''
    const tests: TestRecord[] = []

    // Run the orchestrator: L1 → L2 → L3 → L4 (all fail-open internally)
    const orchestratorResult = await runOrchestrator(changedFiles, diff, config, runHistory, tests, workspace)

    // Merge layer outputs into a single FinalSelection
    const selection = mergeLayers(
      orchestratorResult.layer1,
      orchestratorResult.layer2,
      orchestratorResult.layer3,
      orchestratorResult.layer4,
      config,
      tests,
      flakeScores,
    )

    core.info(
      `[skippr] Selection complete. blocking=${selection.blocking.length} recommended=${selection.recommended.length} skip=${selection.skip.length}`,
    )

    // Build per-test reasoning map from Layer 4 decisions
    const reasoningMap = new Map(
      orchestratorResult.layer4.decisions.map(d => [d.test_path, d.reasoning])
    )

    // Generate and post PR comment (fail-open)
    const commentBody = generateComment(selection, runHistory, config, flakeScores, reasoningMap)
    const githubToken = core.getInput('github-token') || process.env.GITHUB_TOKEN || ''
    if (githubToken) {
      try {
        await postPRComment(githubToken, commentBody)
      } catch (e) {
        console.warn('[skippr] Failed to post PR comment:', e)
      }
    }

    // Set all 6 required action outputs from FinalSelection
    core.setOutput('blocking-tests', JSON.stringify(selection.blocking))
    core.setOutput('recommended-tests', JSON.stringify(selection.recommended))
    core.setOutput('skip-tests', JSON.stringify(selection.skip))
    core.setOutput('selection-confidence', String(selection.overall_confidence))
    core.setOutput('reasoning', selection.pr_comment)
    core.setOutput('estimated-time-saved', String(selection.estimated_time_saved_minutes))

    // --- Shadow mode: persist new run record ---
    const prNumberRaw =
      process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER ??
      process.env.GITHUB_PR_NUMBER ??
      '0'
    const sha = process.env.GITHUB_SHA ?? ''
    const repoId = process.env.GITHUB_REPOSITORY ?? 'unknown'

    const newRecord: RunRecord = {
      id: crypto.randomUUID(),
      repo_id: repoId,
      pr_number: parseInt(prNumberRaw, 10) || 0,
      sha,
      predicted_skip: selection.skip,
      actual_failures: actualFailures,
      all_tests: [...selection.blocking, ...selection.recommended, ...selection.skip],
      mode: config.mode,
      created_at: new Date(),
    }

    try {
      appendRunRecord(runHistoryFile, newRecord)
      await commitRunRecords(workspace, runHistoryFile)
    } catch (e) {
      console.warn('[skippr] Failed to persist run record:', e)
    }

    // --- Shadow mode: accuracy report ---
    const updatedHistory = [...runHistory, newRecord]
    if (updatedHistory.length >= 10) {
      core.info(`[skippr] ${generateAccuracyReport(updatedHistory)}`)
    }
  } catch (err) {
    // Fail-open: log the error but do not fail the action.
    core.warning(
      `[skippr] Unhandled error in main entrypoint: ${String(err)}. Continuing with full suite.`,
    )

    // Set safe defaults so downstream steps don't fail on missing outputs
    core.setOutput('blocking-tests', EMPTY_LIST)
    core.setOutput('recommended-tests', EMPTY_LIST)
    core.setOutput('skip-tests', EMPTY_LIST)
    core.setOutput('selection-confidence', '0')
    core.setOutput('reasoning', 'Analysis unavailable — running full test suite.')
    core.setOutput('estimated-time-saved', '0')
  }
}

// Module-level entrypoint — only fires when executed directly by the Action runner.
run()
