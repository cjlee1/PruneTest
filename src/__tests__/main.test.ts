// src/__tests__/main.test.ts
// Unit tests for the action entrypoint (src/main.ts).
// @actions/core, ../config, ../orchestrator, ../merger, and ../shadow-mode are
// mocked so no real GitHub environment or layer computation is needed.
//
// jest.mock() calls are hoisted by Jest before imports, so the module-level
// run() in main.ts fires against mocked dependencies on first import.

jest.mock('@actions/core')
jest.mock('../config')
jest.mock('../orchestrator')
jest.mock('../merger')
jest.mock('../shadow-mode')
jest.mock('../comment')

// These imports resolve to the auto-mocked versions due to jest.mock() hoisting.
import * as core from '@actions/core'
import * as configModule from '../config'
import * as orchestratorModule from '../orchestrator'
import * as mergerModule from '../merger'
import * as shadowMode from '../shadow-mode'
import * as commentModule from '../comment'
import { run } from '../main'
import type { OrchestratorResult } from '../orchestrator'
import type { FinalSelection } from '../../shared/types'

// Typed mock references
const mockGetInput = core.getInput as jest.MockedFunction<typeof core.getInput>
const mockSetOutput = core.setOutput as jest.MockedFunction<typeof core.setOutput>
const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>
const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>
const mockInfo = core.info as jest.MockedFunction<typeof core.info>
const mockParseConfig = configModule.parseConfig as jest.MockedFunction<typeof configModule.parseConfig>
const mockRunOrchestrator = orchestratorModule.runOrchestrator as jest.MockedFunction<typeof orchestratorModule.runOrchestrator>
const mockMergeLayers = mergerModule.mergeLayers as jest.MockedFunction<typeof mergerModule.mergeLayers>

// Shadow mode mock references
const mockLoadRunRecords = shadowMode.loadRunRecords as jest.MockedFunction<typeof shadowMode.loadRunRecords>
const mockAppendRunRecord = shadowMode.appendRunRecord as jest.MockedFunction<typeof shadowMode.appendRunRecord>
const mockCommitRunRecords = shadowMode.commitRunRecords as jest.MockedFunction<typeof shadowMode.commitRunRecords>
const mockCheckBackstop = shadowMode.checkBackstop as jest.MockedFunction<typeof shadowMode.checkBackstop>
const mockCheckAccuracyFloor = shadowMode.checkAccuracyFloor as jest.MockedFunction<typeof shadowMode.checkAccuracyFloor>
const mockParseJestJson = shadowMode.parseJestJson as jest.MockedFunction<typeof shadowMode.parseJestJson>
const mockGenerateAccuracyReport = shadowMode.generateAccuracyReport as jest.MockedFunction<typeof shadowMode.generateAccuracyReport>
const mockComputeFlakeScores = shadowMode.computeFlakeScores as jest.MockedFunction<typeof shadowMode.computeFlakeScores>

// Comment module mock references
const mockGenerateComment = commentModule.generateComment as jest.MockedFunction<typeof commentModule.generateComment>
const mockPostPRComment = commentModule.postPRComment as jest.MockedFunction<typeof commentModule.postPRComment>

/** A minimal DEFAULT_CONFIG-shaped object for mock returns */
const MOCK_CONFIG = {
  mode: 'shadow' as const,
  testRunner: 'auto' as const,
  testDir: '__tests__',
  runAllTestsOn: [],
  alwaysRun: [],
  neverRun: [],
  architectureNotes: '',
  flakyTestThreshold: 0.15,
  flakyTestQuarantine: 0.40,
  fullSuiteEvery: 50,
}

/** A minimal OrchestratorResult-shaped object for mock returns */
const MOCK_ORCHESTRATOR_RESULT: OrchestratorResult = {
  layer1: {
    blocking_candidates: [],
    run_full_suite: false,
    dependency_graph: {},
    parsing_errors: [],
    processing_time_ms: 0,
  },
  layer2: {
    high_confidence: [],
    medium_confidence: [],
    low_confidence: [],
    similarity_scores: {},
    cache_hits: 0,
    cache_misses: 0,
    api_cost_usd: 0,
    processing_time_ms: 0,
  },
  layer3: {
    ranked_tests: [],
    model_version: 'dormant',
    training_runs_available: 0,
    model_active: false,
    processing_time_ms: 0,
  },
  layer4: {
    decisions: [],
    llm_calls_made: 0,
    total_tokens_used: 0,
    cost_usd: 0,
    fallback_used: true,
    processing_time_ms: 0,
  },
}

/** A realistic FinalSelection for mock returns */
const MOCK_SELECTION: FinalSelection = {
  blocking: ['src/__tests__/auth.test.ts'],
  recommended: ['src/__tests__/utils.test.ts'],
  skip: [],
  mode: 'shadow',
  overall_confidence: 0.75,
  pr_comment: '[skippr] mode=shadow | blocking=1 | recommended=1 | skip=0 | confidence=0.75',
  total_cost_usd: 0.001,
  estimated_time_saved_minutes: 0,
}

describe('src/main.ts — action entrypoint', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Default: return a sensible config
    mockParseConfig.mockReturnValue({ ...MOCK_CONFIG })

    // Default getInput: config-file returns default path, mode is empty
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'config-file') return '.testselector.yml'
      return ''
    })

    // Default orchestrator + merger mocks return valid data
    mockRunOrchestrator.mockResolvedValue({ ...MOCK_ORCHESTRATOR_RESULT })
    mockMergeLayers.mockReturnValue({ ...MOCK_SELECTION })

    // Default shadow mode mocks — all return safe defaults
    mockLoadRunRecords.mockReturnValue([])
    mockAppendRunRecord.mockImplementation(() => undefined)
    mockCommitRunRecords.mockResolvedValue(undefined)
    mockCheckBackstop.mockReturnValue(false)
    mockCheckAccuracyFloor.mockReturnValue(false)
    mockParseJestJson.mockReturnValue([])
    mockGenerateAccuracyReport.mockReturnValue('Over the last 0 PRs...')
    mockComputeFlakeScores.mockReturnValue(new Map())

    // Default comment mocks
    mockGenerateComment.mockReturnValue('## mock comment')
    mockPostPRComment.mockResolvedValue(undefined)
  })

  describe('happy path', () => {
    it('calls parseConfig with the config-file input value', async () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'config-file') return 'custom.yml'
        return ''
      })

      await run()

      expect(mockParseConfig).toHaveBeenCalledWith('custom.yml')
    })

    it('calls parseConfig with default path when config-file input is empty', async () => {
      mockGetInput.mockImplementation(() => '')

      await run()

      expect(mockParseConfig).toHaveBeenCalledWith('.testselector.yml')
    })

    it('sets all six required outputs', async () => {
      await run()

      const outputNames = mockSetOutput.mock.calls.map(([name]) => name)
      expect(outputNames).toContain('blocking-tests')
      expect(outputNames).toContain('recommended-tests')
      expect(outputNames).toContain('skip-tests')
      expect(outputNames).toContain('selection-confidence')
      expect(outputNames).toContain('reasoning')
      expect(outputNames).toContain('estimated-time-saved')
    })

    it('sets blocking-tests, recommended-tests, skip-tests to empty JSON arrays', async () => {
      mockMergeLayers.mockReturnValue({
        ...MOCK_SELECTION,
        blocking: [],
        recommended: [],
        skip: [],
      })

      await run()

      const outputMap = Object.fromEntries(mockSetOutput.mock.calls)
      expect(outputMap['blocking-tests']).toBe('[]')
      expect(outputMap['recommended-tests']).toBe('[]')
      expect(outputMap['skip-tests']).toBe('[]')
    })

    it('logs info with the effective mode from config', async () => {
      mockParseConfig.mockReturnValue({ ...MOCK_CONFIG, mode: 'conservative' })

      await run()

      const infoArgs = mockInfo.mock.calls.map(([msg]) => msg).join('\n')
      expect(infoArgs).toContain('conservative')
    })

    it('uses mode input over config file mode when mode input is non-empty', async () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'mode') return 'aggressive'
        if (name === 'config-file') return '.testselector.yml'
        return ''
      })
      mockParseConfig.mockReturnValue({ ...MOCK_CONFIG, mode: 'shadow' })

      await run()

      const infoArgs = mockInfo.mock.calls.map(([msg]) => msg).join('\n')
      expect(infoArgs).toContain('aggressive')
    })
  })

  describe('api-key wiring', () => {
    it('sets ANTHROPIC_API_KEY from api-key input when env var is not already set', async () => {
      delete process.env.ANTHROPIC_API_KEY
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'api-key') return 'sk-test-key'
        if (name === 'config-file') return '.testselector.yml'
        return ''
      })

      await run()

      expect(process.env.ANTHROPIC_API_KEY).toBe('sk-test-key')

      // Cleanup
      delete process.env.ANTHROPIC_API_KEY
    })

    it('does NOT overwrite ANTHROPIC_API_KEY when it is already set', async () => {
      process.env.ANTHROPIC_API_KEY = 'existing-key'
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'api-key') return 'sk-new-key'
        if (name === 'config-file') return '.testselector.yml'
        return ''
      })

      await run()

      expect(process.env.ANTHROPIC_API_KEY).toBe('existing-key')

      // Cleanup
      delete process.env.ANTHROPIC_API_KEY
    })
  })

  describe('orchestrator + merger wiring', () => {
    it('calls runOrchestrator and passes its result to mergeLayers', async () => {
      await run()

      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1)
      expect(mockMergeLayers).toHaveBeenCalledTimes(1)

      // mergeLayers must receive the exact orchestrator output layers
      const mergeCall = mockMergeLayers.mock.calls[0]
      expect(mergeCall[0]).toEqual(MOCK_ORCHESTRATOR_RESULT.layer1)
      expect(mergeCall[1]).toEqual(MOCK_ORCHESTRATOR_RESULT.layer2)
      expect(mergeCall[2]).toEqual(MOCK_ORCHESTRATOR_RESULT.layer3)
      expect(mergeCall[3]).toEqual(MOCK_ORCHESTRATOR_RESULT.layer4)
    })

    it('sets blocking-tests from FinalSelection.blocking as JSON', async () => {
      mockMergeLayers.mockReturnValue({
        ...MOCK_SELECTION,
        blocking: ['a.test.ts', 'b.test.ts'],
      })

      await run()

      const outputMap = Object.fromEntries(mockSetOutput.mock.calls)
      expect(outputMap['blocking-tests']).toBe('["a.test.ts","b.test.ts"]')
    })

    it('sets selection-confidence from FinalSelection.overall_confidence as string', async () => {
      mockMergeLayers.mockReturnValue({ ...MOCK_SELECTION, overall_confidence: 0.92 })

      await run()

      const outputMap = Object.fromEntries(mockSetOutput.mock.calls)
      expect(outputMap['selection-confidence']).toBe('0.92')
    })

    it('sets reasoning from FinalSelection.pr_comment', async () => {
      const prComment = 'mode=standard | blocking=2 | skip=5'
      mockMergeLayers.mockReturnValue({ ...MOCK_SELECTION, pr_comment: prComment })

      await run()

      const outputMap = Object.fromEntries(mockSetOutput.mock.calls)
      expect(outputMap['reasoning']).toBe(prComment)
    })

    it('sets estimated-time-saved from FinalSelection.estimated_time_saved_minutes as string', async () => {
      mockMergeLayers.mockReturnValue({ ...MOCK_SELECTION, estimated_time_saved_minutes: 12.5 })

      await run()

      const outputMap = Object.fromEntries(mockSetOutput.mock.calls)
      expect(outputMap['estimated-time-saved']).toBe('12.5')
    })

    it('sets skip-tests from FinalSelection.skip as JSON', async () => {
      mockMergeLayers.mockReturnValue({
        ...MOCK_SELECTION,
        skip: ['slow.test.ts', 'flakey.test.ts'],
      })

      await run()

      const outputMap = Object.fromEntries(mockSetOutput.mock.calls)
      expect(outputMap['skip-tests']).toBe('["slow.test.ts","flakey.test.ts"]')
    })

    it('sets recommended-tests from FinalSelection.recommended as JSON', async () => {
      mockMergeLayers.mockReturnValue({
        ...MOCK_SELECTION,
        recommended: ['helpers.test.ts'],
      })

      await run()

      const outputMap = Object.fromEntries(mockSetOutput.mock.calls)
      expect(outputMap['recommended-tests']).toBe('["helpers.test.ts"]')
    })

    it('passes config to both runOrchestrator and mergeLayers', async () => {
      const customConfig = { ...MOCK_CONFIG, mode: 'aggressive' as const }
      mockParseConfig.mockReturnValue(customConfig)
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'config-file') return '.testselector.yml'
        return ''
      })

      await run()

      // runOrchestrator receives config as 3rd argument
      expect(mockRunOrchestrator.mock.calls[0][2]).toMatchObject({ mode: 'aggressive' })
      // mergeLayers receives config as 5th argument
      expect(mockMergeLayers.mock.calls[0][4]).toMatchObject({ mode: 'aggressive' })
    })
  })

  describe('shadow mode wiring', () => {
    it('calls loadRunRecords on every run', async () => {
      await run()
      expect(mockLoadRunRecords).toHaveBeenCalledTimes(1)
    })

    it('calls parseJestJson when test-results-file input is non-empty', async () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'test-results-file') return '/path/to/results.json'
        if (name === 'config-file') return '.testselector.yml'
        return ''
      })

      await run()

      expect(mockParseJestJson).toHaveBeenCalledWith('/path/to/results.json')
    })

    it('does NOT call parseJestJson when test-results-file input is empty', async () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'config-file') return '.testselector.yml'
        return ''
      })

      await run()

      expect(mockParseJestJson).not.toHaveBeenCalled()
    })

    it('calls appendRunRecord after merger completes', async () => {
      await run()

      expect(mockAppendRunRecord).toHaveBeenCalledTimes(1)
      // First arg is the file path, second is the RunRecord
      const record = mockAppendRunRecord.mock.calls[0][1]
      expect(record).toHaveProperty('id')
      expect(record).toHaveProperty('repo_id')
      expect(record).toHaveProperty('predicted_skip')
      expect(record).toHaveProperty('actual_failures')
      expect(record).toHaveProperty('mode')
      expect(record).toHaveProperty('created_at')
    })

    it('calls commitRunRecords after appendRunRecord', async () => {
      await run()

      expect(mockCommitRunRecords).toHaveBeenCalledTimes(1)
    })

    it('logs backstop trigger when checkBackstop returns true', async () => {
      mockCheckBackstop.mockReturnValue(true)

      await run()

      const infoArgs = mockInfo.mock.calls.map(([msg]) => msg).join('\n')
      expect(infoArgs).toContain('Backstop triggered')
    })

    it('logs accuracy floor warning when checkAccuracyFloor returns true', async () => {
      mockCheckAccuracyFloor.mockReturnValue(true)

      await run()

      expect(mockWarning).toHaveBeenCalled()
      const warnArgs = (mockWarning.mock.calls as Array<[string | Error]>)
        .map(([msg]) => String(msg))
        .join('\n')
      expect(warnArgs).toContain('Accuracy floor triggered')
    })

    it('forces shadow mode when accuracy floor triggers', async () => {
      mockCheckAccuracyFloor.mockReturnValue(true)
      mockParseConfig.mockReturnValue({ ...MOCK_CONFIG, mode: 'aggressive' })
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'config-file') return '.testselector.yml'
        return ''
      })

      await run()

      // The orchestrator should receive config with mode overridden to shadow
      const configArg = mockRunOrchestrator.mock.calls[0][2]
      expect(configArg.mode).toBe('shadow')
    })

    it('still completes when loadRunRecords throws (fail-open)', async () => {
      mockLoadRunRecords.mockImplementation(() => {
        throw new Error('disk read error')
      })

      await run()

      // Should NOT call setFailed
      expect(mockSetFailed).not.toHaveBeenCalled()
      // Should still set all six outputs
      const outputNames = mockSetOutput.mock.calls.map(([name]) => name)
      expect(outputNames).toContain('blocking-tests')
      expect(outputNames).toContain('recommended-tests')
      expect(outputNames).toContain('skip-tests')
      expect(outputNames).toContain('selection-confidence')
      expect(outputNames).toContain('reasoning')
      expect(outputNames).toContain('estimated-time-saved')
    })

    it('still completes when commitRunRecords rejects (fail-open)', async () => {
      mockCommitRunRecords.mockRejectedValue(new Error('git push failed'))

      await run()

      expect(mockSetFailed).not.toHaveBeenCalled()
      const outputNames = mockSetOutput.mock.calls.map(([name]) => name)
      expect(outputNames).toContain('blocking-tests')
    })
  })

  describe('fail-open on parseConfig error', () => {
    it('does NOT call core.setFailed when parseConfig throws', async () => {
      mockParseConfig.mockImplementation(() => {
        throw new Error('yaml parse exploded')
      })

      await run()

      expect(mockSetFailed).not.toHaveBeenCalled()
    })

    it('calls core.warning (not setFailed) when parseConfig throws', async () => {
      mockParseConfig.mockImplementation(() => {
        throw new Error('disk read error')
      })

      await run()

      expect(mockWarning).toHaveBeenCalled()
      const warnMsg = mockWarning.mock.calls[0][0] as string
      expect(warnMsg).toMatch(/unhandled error|Unhandled error/i)
    })

    it('still sets all six outputs when parseConfig throws', async () => {
      mockParseConfig.mockImplementation(() => {
        throw new Error('catastrophic failure')
      })

      await run()

      const outputNames = mockSetOutput.mock.calls.map(([name]) => name)
      expect(outputNames).toContain('blocking-tests')
      expect(outputNames).toContain('recommended-tests')
      expect(outputNames).toContain('skip-tests')
      expect(outputNames).toContain('selection-confidence')
      expect(outputNames).toContain('reasoning')
      expect(outputNames).toContain('estimated-time-saved')
    })
  })

  describe('fail-open on orchestrator/merger error', () => {
    it('does NOT call core.setFailed when runOrchestrator rejects', async () => {
      mockRunOrchestrator.mockRejectedValue(new Error('orchestrator exploded'))

      await run()

      expect(mockSetFailed).not.toHaveBeenCalled()
    })

    it('calls core.warning when runOrchestrator rejects', async () => {
      mockRunOrchestrator.mockRejectedValue(new Error('orchestrator exploded'))

      await run()

      expect(mockWarning).toHaveBeenCalled()
    })

    it('still sets all six outputs when runOrchestrator rejects', async () => {
      mockRunOrchestrator.mockRejectedValue(new Error('pipeline down'))

      await run()

      const outputNames = mockSetOutput.mock.calls.map(([name]) => name)
      expect(outputNames).toContain('blocking-tests')
      expect(outputNames).toContain('recommended-tests')
      expect(outputNames).toContain('skip-tests')
      expect(outputNames).toContain('selection-confidence')
      expect(outputNames).toContain('reasoning')
      expect(outputNames).toContain('estimated-time-saved')
    })

    it('does NOT call core.setFailed when mergeLayers throws', async () => {
      mockMergeLayers.mockImplementation(() => {
        throw new Error('merger exploded')
      })

      await run()

      expect(mockSetFailed).not.toHaveBeenCalled()
    })

    it('still sets all six outputs when mergeLayers throws', async () => {
      mockMergeLayers.mockImplementation(() => {
        throw new Error('merger exploded')
      })

      await run()

      const outputNames = mockSetOutput.mock.calls.map(([name]) => name)
      expect(outputNames).toContain('blocking-tests')
      expect(outputNames).toContain('recommended-tests')
      expect(outputNames).toContain('skip-tests')
      expect(outputNames).toContain('selection-confidence')
      expect(outputNames).toContain('reasoning')
      expect(outputNames).toContain('estimated-time-saved')
    })
  })
})

// ── Flake score wiring tests ───────────────────────────────────────────────

describe('flake score wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockParseConfig.mockReturnValue({ ...MOCK_CONFIG })
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'config-file') return '.testselector.yml'
      return ''
    })
    mockRunOrchestrator.mockResolvedValue({ ...MOCK_ORCHESTRATOR_RESULT })
    mockMergeLayers.mockReturnValue({ ...MOCK_SELECTION })
    mockLoadRunRecords.mockReturnValue([])
    mockAppendRunRecord.mockImplementation(() => undefined)
    mockCommitRunRecords.mockResolvedValue(undefined)
    mockCheckBackstop.mockReturnValue(false)
    mockCheckAccuracyFloor.mockReturnValue(false)
    mockParseJestJson.mockReturnValue([])
    mockGenerateAccuracyReport.mockReturnValue('Over the last 0 PRs...')
    mockComputeFlakeScores.mockReturnValue(new Map())
    mockGenerateComment.mockReturnValue('## mock comment')
    mockPostPRComment.mockResolvedValue(undefined)
  })

  it('calls computeFlakeScores with the loaded runHistory', async () => {
    const runHistory = [
      {
        id: 'r1', repo_id: 'owner/repo', pr_number: 1, sha: 'abc',
        predicted_skip: [], actual_failures: [], all_tests: [],
        mode: 'shadow' as const, created_at: new Date(),
      },
    ]
    mockLoadRunRecords.mockReturnValue(runHistory)

    await run()

    expect(mockComputeFlakeScores).toHaveBeenCalledTimes(1)
    expect(mockComputeFlakeScores).toHaveBeenCalledWith(runHistory)
  })

  it('passes flakeScores as 4th arg to generateComment and 7th arg to mergeLayers', async () => {
    const fakeScores = new Map([['flaky.test.ts', 0.55]])
    mockComputeFlakeScores.mockReturnValue(fakeScores)

    await run()

    // generateComment 4th arg should be the flakeScores map
    expect(mockGenerateComment).toHaveBeenCalledTimes(1)
    expect(mockGenerateComment.mock.calls[0][3]).toBe(fakeScores)

    // mergeLayers 7th arg (index 6) should be the flakeScores map
    expect(mockMergeLayers).toHaveBeenCalledTimes(1)
    expect(mockMergeLayers.mock.calls[0][6]).toBe(fakeScores)
  })
})

// ── Comment integration tests ──────────────────────────────────────────────
// Isolated at the end of main.test.ts as a separate top-level describe so the
// comment mock can be cleanly managed without interfering with earlier blocks.

describe('comment integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockParseConfig.mockReturnValue({ ...MOCK_CONFIG })
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'config-file') return '.testselector.yml'
      if (name === 'github-token') return 'ghs_testtoken'
      return ''
    })
    mockRunOrchestrator.mockResolvedValue({ ...MOCK_ORCHESTRATOR_RESULT })
    mockMergeLayers.mockReturnValue({ ...MOCK_SELECTION })
    mockLoadRunRecords.mockReturnValue([])
    mockAppendRunRecord.mockImplementation(() => undefined)
    mockCommitRunRecords.mockResolvedValue(undefined)
    mockCheckBackstop.mockReturnValue(false)
    mockCheckAccuracyFloor.mockReturnValue(false)
    mockParseJestJson.mockReturnValue([])
    mockGenerateAccuracyReport.mockReturnValue('Over the last 0 PRs...')
    mockComputeFlakeScores.mockReturnValue(new Map())
    mockGenerateComment.mockReturnValue('## mock comment')
    mockPostPRComment.mockResolvedValue(undefined)

    // Ensure GITHUB_TOKEN env var is cleared so tests control token source
    delete process.env.GITHUB_TOKEN
  })

  it('calls generateComment with (selection, runHistory, config) after mergeLayers', async () => {
    const runHistory = [{ id: 'r1', repo_id: 'owner/repo', pr_number: 1, sha: 'abc', predicted_skip: [], actual_failures: [], all_tests: [], mode: 'shadow', created_at: new Date() }]
    mockLoadRunRecords.mockReturnValue(runHistory)

    await run()

    expect(mockGenerateComment).toHaveBeenCalledTimes(1)
    const [selectionArg, runHistoryArg, configArg] = mockGenerateComment.mock.calls[0]
    expect(selectionArg).toMatchObject({ blocking: MOCK_SELECTION.blocking })
    expect(runHistoryArg).toEqual(runHistory)
    expect(configArg).toMatchObject({ mode: 'shadow' })
  })

  it('calls postPRComment with token and generateComment return value when github-token is non-empty', async () => {
    await run()

    expect(mockPostPRComment).toHaveBeenCalledTimes(1)
    expect(mockPostPRComment).toHaveBeenCalledWith('ghs_testtoken', '## mock comment')
  })

  it('does NOT call postPRComment when github-token input is empty and GITHUB_TOKEN env is unset', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'config-file') return '.testselector.yml'
      return ''
    })
    delete process.env.GITHUB_TOKEN

    await run()

    expect(mockPostPRComment).not.toHaveBeenCalled()
  })

  it('still sets all 6 outputs when postPRComment rejects — does not call setFailed', async () => {
    mockPostPRComment.mockRejectedValue(new Error('API down'))

    await run()

    expect(mockSetFailed).not.toHaveBeenCalled()
    const outputNames = mockSetOutput.mock.calls.map(([name]) => name)
    expect(outputNames).toContain('blocking-tests')
    expect(outputNames).toContain('recommended-tests')
    expect(outputNames).toContain('skip-tests')
    expect(outputNames).toContain('selection-confidence')
    expect(outputNames).toContain('reasoning')
    expect(outputNames).toContain('estimated-time-saved')
  })

  it('passes the loaded runHistory array to generateComment', async () => {
    const runHistory = [
      { id: 'a', repo_id: 'r', pr_number: 1, sha: 's1', predicted_skip: [], actual_failures: [], all_tests: [], mode: 'shadow' as const, created_at: new Date() },
      { id: 'b', repo_id: 'r', pr_number: 2, sha: 's2', predicted_skip: [], actual_failures: [], all_tests: [], mode: 'shadow' as const, created_at: new Date() },
    ]
    mockLoadRunRecords.mockReturnValue(runHistory)

    await run()

    const runHistoryArg = mockGenerateComment.mock.calls[0][1]
    expect(runHistoryArg).toHaveLength(2)
    expect(runHistoryArg[0].id).toBe('a')
    expect(runHistoryArg[1].id).toBe('b')
  })
})
