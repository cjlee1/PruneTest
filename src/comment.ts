// src/comment.ts
// Generates a formatted Markdown PR comment summarising the selection and
// posts it to GitHub via @actions/github.
//
// Iron rule: generateComment() NEVER throws. Any internal error returns the
// fixed fallback string so the action stays fail-open.

import type { FinalSelection, RunRecord, SelectorConfig } from '../shared/types'
import { context, getOctokit } from '@actions/github'

/** Fallback comment returned when generateComment() encounters any error. */
const FALLBACK_COMMENT =
  '## 🧪 PruneTest\n\nAnalysis unavailable — running full test suite.'

/**
 * Generate a PRD-formatted Markdown comment summarising the selection result.
 *
 * @param selection    - Merged layer output (blocking / recommended / skip lists).
 * @param runHistory   - Historical run records (used to compute shadow-mode counter).
 * @param config       - Parsed selector config (mode, fullSuiteEvery, etc.).
 * @param flakeScores  - Optional map of test path → flake rate (0–1).
 * @param reasoningMap - Optional map of test path → LLM reasoning string.
 * @returns            Formatted Markdown string; never throws.
 */
export function generateComment(
  selection: FinalSelection,
  runHistory: RunRecord[],
  config: SelectorConfig,
  flakeScores?: Map<string, number>,
  reasoningMap?: Map<string, string>,
): string {
  try {
    const isShadow = selection.mode === 'shadow'
    const header = isShadow
      ? '## 🧪 PruneTest — Shadow Mode'
      : '## 🧪 PruneTest — Selection Mode'
    const verb = isShadow ? 'would run' : 'Running'

    const total = selection.blocking.length + selection.recommended.length + selection.skip.length
    const skipPct =
      total > 0 ? ((selection.skip.length / total) * 100).toFixed(1) : '0.0'

    const confidencePct = `${Math.round(selection.overall_confidence * 100)}%`

    // ── Blocking table ────────────────────────────────────────────────────
    const blockingRows = selection.blocking
      .map((test) => {
        const reason = reasoningMap?.get(test) ?? 'Static/embedding analysis'
        return `| \`${test}\` | ${reason} | ${confidencePct} |`
      })
      .join('\n')

    const blockingSection =
      selection.blocking.length > 0
        ? `### Blocking (${selection.blocking.length} tests — ${verb})\n\n| Test | Reason | Confidence |\n|------|--------|------------|\n${blockingRows}`
        : `### Blocking (0 tests — ${verb})\n\n| Test | Reason | Confidence |\n|------|--------|------------|`

    // ── Recommended list ──────────────────────────────────────────────────
    const recommendedLines = selection.recommended.map((test) => `- \`${test}\``).join('\n')
    const recommendedSection =
      selection.recommended.length > 0
        ? `### Recommended (${selection.recommended.length} tests)\n\n${recommendedLines}`
        : `### Recommended (0 tests)`

    // ── Skip section ──────────────────────────────────────────────────────
    const skipSection = `### Skip (${selection.skip.length} tests — full list in dashboard)\n\n_${skipPct}% of total tests skipped_`

    // ── Shadow run counter (shadow mode only) ────────────────────────────
    const remaining = Math.max(0, config.fullSuiteEvery - runHistory.length)
    const shadowCounterLine = isShadow
      ? `\n📊 **Shadow mode:** Running full suite. Selection takes effect after ${remaining} runs.`
      : ''

    // ── Projected savings ─────────────────────────────────────────────────
    const savingsLine = `💰 **Projected savings:** ~${selection.estimated_time_saved_minutes} min/PR`

    // ── LLM cost ─────────────────────────────────────────────────────────
    const costLine = `*LLM cost this PR: ~$${selection.total_cost_usd.toFixed(3)}*`

    // ── Flaky test warning ────────────────────────────────────────────────
    let flakeWarning = ''
    if (flakeScores && flakeScores.size > 0) {
      const flakyTests = [...flakeScores.entries()]
        .filter(([, score]) => score > config.flakyTestThreshold)
        .map(([path]) => `\`${path}\``)

      if (flakyTests.length > 0) {
        flakeWarning = `\n⚠️ **Flaky tests detected:** ${flakyTests.join(', ')} — results may be unreliable`
      }
    }

    return [
      header,
      '',
      blockingSection,
      '',
      recommendedSection,
      '',
      skipSection,
      shadowCounterLine,
      savingsLine,
      costLine,
      flakeWarning,
    ]
      .join('\n')
      .trimEnd()
  } catch {
    return FALLBACK_COMMENT
  }
}

/**
 * Post `body` as a PR comment via the GitHub REST API.
 *
 * No-ops when not running in a pull_request event context.
 * Never throws — the caller is responsible for wrapping in try/catch if needed.
 *
 * @param token - GitHub token with `pull-requests: write` permission.
 * @param body  - Markdown comment body (from generateComment).
 */
export async function postPRComment(token: string, body: string): Promise<void> {
  if (context.eventName !== 'pull_request') {
    return
  }

  const octokit = getOctokit(token)
  await octokit.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.issue.number,
    body,
  })
}
