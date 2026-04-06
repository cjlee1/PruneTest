// src/__tests__/comment.test.ts
// Unit tests for generateComment() and postPRComment() in src/comment.ts.
// @actions/github is mocked so no real GitHub context or network is needed.

jest.mock('@actions/github', () => ({
  context: {
    eventName: 'pull_request',
    repo: { owner: 'owner', repo: 'repo' },
    issue: { number: 42 },
  },
  getOctokit: jest.fn().mockReturnValue({
    rest: {
      issues: {
        createComment: jest.fn().mockResolvedValue({}),
      },
    },
  }),
}))

import { generateComment, postPRComment } from '../comment'
import { getOctokit } from '@actions/github'
import type { FinalSelection, RunRecord, SelectorConfig } from '../../shared/types'

// ── Test fixtures ──────────────────────────────────────────────────────────

const MOCK_SELECTION: FinalSelection = {
  blocking: ['auth.test.ts'],
  recommended: ['utils.test.ts'],
  skip: ['slow.test.ts'],
  mode: 'shadow',
  overall_confidence: 0.75,
  pr_comment: '...',
  total_cost_usd: 0.004,
  estimated_time_saved_minutes: 8,
}

const MOCK_CONFIG: SelectorConfig = {
  mode: 'shadow',
  testRunner: 'auto',
  testDir: '__tests__',
  runAllTestsOn: [],
  alwaysRun: [],
  neverRun: [],
  architectureNotes: '',
  flakyTestThreshold: 0.15,
  flakyTestQuarantine: 0.40,
  fullSuiteEvery: 50,
}

const MOCK_RUN_HISTORY: RunRecord[] = Array.from({ length: 10 }, (_, i) => ({
  id: `run-${i}`,
  repo_id: 'owner/repo',
  pr_number: i + 1,
  sha: `sha${i}`,
  predicted_skip: [],
  actual_failures: [],
  all_tests: [],
  mode: 'shadow',
  created_at: new Date(),
}))

// ── generateComment — shadow mode ─────────────────────────────────────────

describe('generateComment — shadow mode', () => {
  it('header contains "Shadow Mode"', () => {
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('Shadow Mode')
  })

  it('header contains "would run" verb', () => {
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('would run')
  })

  it('shadow run counter shows remaining runs (50 - 10 = 40)', () => {
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('Selection takes effect after 40 runs')
  })

  it('blocking table has row for auth.test.ts', () => {
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('auth.test.ts')
  })

  it('blocking table includes confidence header', () => {
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('| Test | Reason | Confidence |')
  })

  it('blocking row shows 75% confidence', () => {
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('75%')
  })

  it('recommended list has entry for utils.test.ts', () => {
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('utils.test.ts')
  })

  it('skip section shows count (1 test)', () => {
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('Skip (1 tests')
  })

  it('projected savings shows minutes', () => {
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('~8 min/PR')
  })

  it('LLM cost line present with $0.004 formatted', () => {
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('LLM cost this PR')
    expect(result).toContain('$0.004')
  })

  it('zero-test edge case (all arrays empty) formats without crash', () => {
    const emptySelection: FinalSelection = {
      ...MOCK_SELECTION,
      blocking: [],
      recommended: [],
      skip: [],
    }
    expect(() => generateComment(emptySelection, MOCK_RUN_HISTORY, MOCK_CONFIG)).not.toThrow()
    const result = generateComment(emptySelection, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('Shadow Mode')
  })

  it('run counter is 0 when history length >= fullSuiteEvery', () => {
    const fullHistory: RunRecord[] = Array.from({ length: 50 }, (_, i) => ({
      id: `run-${i}`,
      repo_id: 'owner/repo',
      pr_number: i + 1,
      sha: `sha${i}`,
      predicted_skip: [],
      actual_failures: [],
      all_tests: [],
      mode: 'shadow',
      created_at: new Date(),
    }))
    const result = generateComment(MOCK_SELECTION, fullHistory, MOCK_CONFIG)
    expect(result).toContain('Selection takes effect after 0 runs')
  })
})

// ── generateComment — selection (non-shadow) mode ─────────────────────────

describe('generateComment — selection mode', () => {
  const conservativeSelection: FinalSelection = {
    ...MOCK_SELECTION,
    mode: 'conservative',
  }

  it('header contains "Selection Mode"', () => {
    const result = generateComment(conservativeSelection, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('Selection Mode')
  })

  it('does NOT contain "would run"', () => {
    const result = generateComment(conservativeSelection, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).not.toContain('would run')
  })

  it('does NOT contain shadow run counter line', () => {
    const result = generateComment(conservativeSelection, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).not.toContain('Shadow mode:')
  })

  it('uses "Running" verb in blocking section', () => {
    const result = generateComment(conservativeSelection, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('Running')
  })
})

// ── generateComment — fail-open ───────────────────────────────────────────

describe('generateComment — fail-open', () => {
  it('returns fallback string when config is null (never throws)', () => {
    // Passing null as config triggers an internal error; must not throw
    let result: string
    expect(() => {
      result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, null as unknown as SelectorConfig)
    }).not.toThrow()
    expect(result!).toContain('Analysis unavailable')
  })

  it('returns the fixed fallback string on internal error', () => {
    const result = generateComment(
      MOCK_SELECTION,
      MOCK_RUN_HISTORY,
      null as unknown as SelectorConfig,
    )
    expect(result).toBe(
      '## 🧪 Skippr\n\nAnalysis unavailable — running full test suite.',
    )
  })
})

// ── generateComment — flake scores ───────────────────────────────────────

describe('generateComment — flake scores', () => {
  it('shows flaky warning when auth.test.ts score 0.42 exceeds threshold 0.15', () => {
    const flakeScores = new Map([['auth.test.ts', 0.42]])
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG, flakeScores)
    expect(result).toContain('Flaky tests detected')
    expect(result).toContain('auth.test.ts')
  })

  it('flaky warning NOT present when all scores are at or below threshold', () => {
    const flakeScores = new Map([
      ['auth.test.ts', 0.10],
      ['utils.test.ts', 0.15],
    ])
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG, flakeScores)
    expect(result).not.toContain('Flaky tests detected')
  })

  it('flaky warning NOT present when flakeScores is undefined', () => {
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).not.toContain('Flaky tests detected')
  })

  it('lists only tests above threshold in flaky warning', () => {
    const flakeScores = new Map([
      ['auth.test.ts', 0.42],   // above threshold
      ['utils.test.ts', 0.05],  // below threshold
    ])
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG, flakeScores)
    expect(result).toContain('auth.test.ts')
    // utils.test.ts appears in the recommended section, but NOT in the flake warning text
    // We check the warning line specifically
    const warningLine = result.split('\n').find((l) => l.includes('Flaky tests detected')) ?? ''
    expect(warningLine).not.toContain('utils.test.ts')
  })
})

// ── generateComment — reasoning passthrough ───────────────────────────────

describe('generateComment — reasoning passthrough', () => {
  it('blocking row contains LLM reasoning string when reasoningMap has an entry for the test', () => {
    const reasoningMap = new Map([['auth.test.ts', 'Tests OAuth token refresh path']])
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG, undefined, reasoningMap)
    expect(result).toContain('Tests OAuth token refresh path')
  })

  it('blocking row falls back to "Static/embedding analysis" when reasoningMap is absent', () => {
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG)
    expect(result).toContain('Static/embedding analysis')
  })

  it('blocking row falls back to "Static/embedding analysis" when reasoningMap has no entry for the test', () => {
    const reasoningMap = new Map([['other.test.ts', 'Some reason']])
    const result = generateComment(MOCK_SELECTION, MOCK_RUN_HISTORY, MOCK_CONFIG, undefined, reasoningMap)
    // auth.test.ts is the blocking test; it has no entry in the map
    const blockingSection = result.split('\n').find(l => l.includes('auth.test.ts')) ?? ''
    expect(blockingSection).toContain('Static/embedding analysis')
  })
})

// ── postPRComment ─────────────────────────────────────────────────────────

describe('postPRComment', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Re-apply default mock return
    ;(getOctokit as jest.Mock).mockReturnValue({
      rest: {
        issues: {
          createComment: jest.fn().mockResolvedValue({}),
        },
      },
    })
  })

  it('calls getOctokit with the provided token', async () => {
    await postPRComment('my-token', '## comment')
    expect(getOctokit).toHaveBeenCalledWith('my-token')
  })

  it('calls createComment with correct owner, repo, and issue_number', async () => {
    const mockCreate = jest.fn().mockResolvedValue({})
    ;(getOctokit as jest.Mock).mockReturnValue({
      rest: { issues: { createComment: mockCreate } },
    })

    await postPRComment('token', 'body text')

    expect(mockCreate).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 42,
      body: 'body text',
    })
  })

  it('is a no-op when eventName is not pull_request', async () => {
    // Temporarily override the context mock
    const github = jest.requireMock('@actions/github') as {
      context: { eventName: string }
    }
    const originalEventName = github.context.eventName
    github.context.eventName = 'push'

    await postPRComment('token', 'body')

    expect(getOctokit).not.toHaveBeenCalled()

    // Restore
    github.context.eventName = originalEventName
  })
})
