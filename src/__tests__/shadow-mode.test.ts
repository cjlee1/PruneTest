// src/__tests__/shadow-mode.test.ts
// Unit tests for the shadow mode engine.
// @actions/exec and fs are mocked at the top level (hoisted by Jest).

jest.mock('@actions/exec')
jest.mock('fs', () => {
  const actualFs = jest.requireActual<typeof import('fs')>('fs')
  return {
    ...actualFs,
    readFileSync: jest.fn(actualFs.readFileSync),
    appendFileSync: jest.fn(actualFs.appendFileSync),
    mkdirSync: jest.fn(actualFs.mkdirSync),
  }
})

import * as fs from 'fs'
import * as path from 'path'
import * as actionsExec from '@actions/exec'
import type { RunRecord } from '../../shared/types'
import {
  loadRunRecords,
  appendRunRecord,
  commitRunRecords,
  generateAccuracyReport,
  checkBackstop,
  checkAccuracyFloor,
  parseJestJson,
  computeFlakeScores,
} from '../shadow-mode'

const mockExec = actionsExec.exec as jest.MockedFunction<typeof actionsExec.exec>
const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>
const mockAppendFileSync = fs.appendFileSync as jest.MockedFunction<typeof fs.appendFileSync>
const mockMkdirSync = fs.mkdirSync as jest.MockedFunction<typeof fs.mkdirSync>

const FIXTURE_RUNS = path.resolve(__dirname, '../../fixtures/runs.jsonl')
const FIXTURE_JEST = path.resolve(__dirname, '../../fixtures/jest-results.json')

/** Build a minimal RunRecord for testing */
function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'test-id',
    repo_id: 'repo-test',
    pr_number: 1,
    sha: 'abc123',
    predicted_skip: [],
    actual_failures: [],
    all_tests: ['a.test.ts', 'b.test.ts'],
    mode: 'shadow',
    created_at: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('loadRunRecords', () => {
  beforeEach(() => {
    // Reset to actual fs behavior by default
    mockReadFileSync.mockImplementation(jest.requireActual<typeof import('fs')>('fs').readFileSync)
  })

  it('reads the fixture runs.jsonl and returns 200 records', () => {
    const records = loadRunRecords(FIXTURE_RUNS)
    expect(records).toHaveLength(200)
  })

  it('returns first 50 records when sliced', () => {
    const records = loadRunRecords(FIXTURE_RUNS)
    expect(records.slice(0, 50)).toHaveLength(50)
  })

  it('reconstructs created_at as Date instances', () => {
    const records = loadRunRecords(FIXTURE_RUNS)
    expect(records[0].created_at).toBeInstanceOf(Date)
    expect(records[0].created_at.getFullYear()).toBeGreaterThanOrEqual(2024)
  })

  it('returns [] for a non-existent file', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const records = loadRunRecords('/no/such/file.jsonl')
    expect(records).toEqual([])
    expect(stderrSpy).toHaveBeenCalled()
    stderrSpy.mockRestore()
  })

  it('returns [] for an empty file', () => {
    mockReadFileSync.mockReturnValue('')
    const records = loadRunRecords('/fake/empty.jsonl')
    expect(records).toEqual([])
  })

  it('skips malformed lines and returns valid ones', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const validLine = JSON.stringify({
      id: '1',
      repo_id: 'r',
      pr_number: 1,
      sha: 'a',
      predicted_skip: [],
      actual_failures: [],
      all_tests: [],
      mode: 'shadow',
      created_at: '2024-01-01T00:00:00Z',
    })
    mockReadFileSync.mockReturnValue(`${validLine}\n{bad json}\n${validLine}\n`)
    const records = loadRunRecords('/fake/mixed.jsonl')
    expect(records).toHaveLength(2)
    expect(stderrSpy).toHaveBeenCalled()
    stderrSpy.mockRestore()
  })
})

describe('appendRunRecord', () => {
  beforeEach(() => {
    mockMkdirSync.mockClear()
    mockAppendFileSync.mockClear()
    mockMkdirSync.mockImplementation(() => undefined as unknown as string)
    mockAppendFileSync.mockImplementation(() => undefined)
  })

  it('creates parent directory with recursive: true', () => {
    const record = makeRecord()
    appendRunRecord('/fake/.testselector/runs.jsonl', record)
    expect(mockMkdirSync).toHaveBeenCalledWith('/fake/.testselector', { recursive: true })
  })

  it('appends a JSON line ending with newline', () => {
    const record = makeRecord()
    appendRunRecord('/fake/runs.jsonl', record)
    expect(mockAppendFileSync).toHaveBeenCalledTimes(1)
    const written = mockAppendFileSync.mock.calls[0][1] as string
    expect(written.endsWith('\n')).toBe(true)
    // Should be valid JSON (without the trailing newline)
    expect(() => JSON.parse(written.trim())).not.toThrow()
  })

  it('serializes created_at as an ISO string', () => {
    const record = makeRecord({ created_at: new Date('2024-06-15T12:00:00Z') })
    appendRunRecord('/fake/runs.jsonl', record)
    const written = mockAppendFileSync.mock.calls[0][1] as string
    const parsed = JSON.parse(written.trim())
    expect(parsed.created_at).toBe('2024-06-15T12:00:00.000Z')
  })

  it('does not throw when appendFileSync fails', () => {
    mockAppendFileSync.mockImplementation(() => {
      throw new Error('disk full')
    })
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(() => appendRunRecord('/fake/runs.jsonl', makeRecord())).not.toThrow()
    expect(stderrSpy).toHaveBeenCalled()
    stderrSpy.mockRestore()
  })
})

describe('commitRunRecords', () => {
  beforeEach(() => {
    mockExec.mockResolvedValue(0)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('calls exec 5 times for the git workflow', async () => {
    await commitRunRecords('/workspace', '.testselector/runs.jsonl')
    expect(mockExec).toHaveBeenCalledTimes(5)
  })

  it('passes cwd option to all exec calls', async () => {
    await commitRunRecords('/workspace', '.testselector/runs.jsonl')
    for (const call of mockExec.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ cwd: '/workspace' }))
    }
  })

  it('includes [skip ci] in the commit message', async () => {
    await commitRunRecords('/workspace', '.testselector/runs.jsonl')
    const commitCall = mockExec.mock.calls[3]
    expect(commitCall[0]).toBe('git')
    expect(commitCall[1]).toContain('chore: update run records [skip ci]')
  })

  it('calls git config, add, commit, push in order', async () => {
    await commitRunRecords('/workspace', '.testselector/runs.jsonl')
    const commands = mockExec.mock.calls.map(
      (call) => `${call[0]} ${(call[1] as string[]).join(' ')}`,
    )
    expect(commands[0]).toContain('git config user.email')
    expect(commands[1]).toContain('git config user.name')
    expect(commands[2]).toContain('git add')
    expect(commands[3]).toContain('git commit')
    expect(commands[4]).toContain('git push')
  })

  it('does not throw when exec rejects', async () => {
    mockExec.mockRejectedValue(new Error('git push failed'))
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(
      commitRunRecords('/workspace', '.testselector/runs.jsonl'),
    ).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('generateAccuracyReport', () => {
  it('returns "No run history available." for empty array', () => {
    expect(generateAccuracyReport([])).toBe('No run history available.')
  })

  it('returns a string containing "%" for non-empty runs from fixture', () => {
    // Use actual fs for this test
    mockReadFileSync.mockImplementation(jest.requireActual<typeof import('fs')>('fs').readFileSync)
    const records = loadRunRecords(FIXTURE_RUNS).slice(0, 50)
    const report = generateAccuracyReport(records)
    expect(report).toContain('%')
    expect(report).toContain('50 PRs')
  })

  it('reports 100.0% recall when no actual failures exist', () => {
    const runs = [
      makeRecord({ predicted_skip: ['a.test.ts'], actual_failures: [] }),
      makeRecord({ predicted_skip: ['b.test.ts'], actual_failures: [] }),
    ]
    const report = generateAccuracyReport(runs)
    expect(report).toContain('100.0% of failures')
  })

  it('reports reduced recall when predicted_skip intersects actual_failures', () => {
    const runs = [
      makeRecord({
        predicted_skip: ['a.test.ts'],
        actual_failures: ['a.test.ts'],
        all_tests: ['a.test.ts', 'b.test.ts'],
      }),
    ]
    const report = generateAccuracyReport(runs)
    // 1 actual failure, 1 missed → recall = 0%
    expect(report).toContain('0.0% of failures')
  })

  it('computes correct skip percentage', () => {
    const runs = [
      makeRecord({
        predicted_skip: ['a.test.ts'],
        actual_failures: [],
        all_tests: ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'],
      }),
    ]
    const report = generateAccuracyReport(runs)
    // 1/4 = 25%
    expect(report).toContain('25.0%')
  })
})

describe('checkBackstop', () => {
  it('returns false for runCount 0', () => {
    expect(checkBackstop(0, 50)).toBe(false)
  })

  it('returns true for runCount 50 with fullSuiteEvery 50', () => {
    expect(checkBackstop(50, 50)).toBe(true)
  })

  it('returns true for runCount 100 with fullSuiteEvery 50', () => {
    expect(checkBackstop(100, 50)).toBe(true)
  })

  it('returns false for runCount 49', () => {
    expect(checkBackstop(49, 50)).toBe(false)
  })

  it('returns false for runCount 1', () => {
    expect(checkBackstop(1, 50)).toBe(false)
  })

  it('returns false for runCount 51', () => {
    expect(checkBackstop(51, 50)).toBe(false)
  })
})

describe('checkAccuracyFloor', () => {
  it('returns false when runs.length < windowSize', () => {
    const runs = Array.from({ length: 19 }, () => makeRecord())
    expect(checkAccuracyFloor(runs)).toBe(false)
  })

  it('returns false when recall >= 0.99 (no missed failures)', () => {
    // 20 runs, all with actual_failures but none in predicted_skip → recall = 100%
    const runs = Array.from({ length: 20 }, () =>
      makeRecord({
        predicted_skip: ['x.test.ts'],
        actual_failures: ['a.test.ts'],
        all_tests: ['a.test.ts', 'x.test.ts'],
      }),
    )
    expect(checkAccuracyFloor(runs)).toBe(false)
  })

  it('returns true when recall < 0.99 (many missed failures)', () => {
    // 20 runs, all with actual_failures that ARE in predicted_skip → recall = 0%
    const runs = Array.from({ length: 20 }, () =>
      makeRecord({
        predicted_skip: ['a.test.ts'],
        actual_failures: ['a.test.ts'],
        all_tests: ['a.test.ts', 'b.test.ts'],
      }),
    )
    expect(checkAccuracyFloor(runs)).toBe(true)
  })

  it('returns false when no actual failures exist in the window', () => {
    const runs = Array.from({ length: 20 }, () =>
      makeRecord({ actual_failures: [] }),
    )
    expect(checkAccuracyFloor(runs)).toBe(false)
  })

  it('uses only the last windowSize entries', () => {
    // First 20 runs: bad recall. Last 20 runs: perfect recall.
    const badRuns = Array.from({ length: 20 }, () =>
      makeRecord({
        predicted_skip: ['a.test.ts'],
        actual_failures: ['a.test.ts'],
        all_tests: ['a.test.ts'],
      }),
    )
    const goodRuns = Array.from({ length: 20 }, () =>
      makeRecord({
        predicted_skip: ['x.test.ts'],
        actual_failures: ['a.test.ts'],
        all_tests: ['a.test.ts', 'x.test.ts'],
      }),
    )
    // Window only sees the last 20 (good runs)
    expect(checkAccuracyFloor([...badRuns, ...goodRuns])).toBe(false)
  })
})

describe('parseJestJson', () => {
  const originalEnv = process.env.GITHUB_WORKSPACE

  beforeEach(() => {
    process.env.GITHUB_WORKSPACE = '/github/workspace'
    // Reset to actual fs behavior by default
    mockReadFileSync.mockImplementation(jest.requireActual<typeof import('fs')>('fs').readFileSync)
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GITHUB_WORKSPACE
    } else {
      process.env.GITHUB_WORKSPACE = originalEnv
    }
  })

  it('reads the fixture and returns the failed test path', () => {
    const failures = parseJestJson(FIXTURE_JEST)
    expect(failures).toEqual(['src/__tests__/auth.test.ts'])
  })

  it('excludes passed tests', () => {
    const failures = parseJestJson(FIXTURE_JEST)
    expect(failures).not.toContain('src/__tests__/utils.test.ts')
  })

  it('returns [] for a non-existent file', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(parseJestJson('/no/such/file.json')).toEqual([])
    stderrSpy.mockRestore()
  })

  it('returns [] for malformed JSON', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    mockReadFileSync.mockReturnValue('{not valid json' as unknown as string)
    expect(parseJestJson('/fake/bad.json')).toEqual([])
    stderrSpy.mockRestore()
  })

  it('returns [] when testResults is missing', () => {
    mockReadFileSync.mockReturnValue('{"success": true}' as unknown as string)
    expect(parseJestJson('/fake/empty.json')).toEqual([])
  })

  it('returns sorted paths', () => {
    const data = {
      testResults: [
        { testFilePath: '/github/workspace/z.test.ts', status: 'failed' },
        { testFilePath: '/github/workspace/a.test.ts', status: 'failed' },
      ],
    }
    mockReadFileSync.mockReturnValue(JSON.stringify(data) as unknown as string)
    const result = parseJestJson('/fake/results.json')
    expect(result).toEqual(['a.test.ts', 'z.test.ts'])
  })
})

describe('computeFlakeScores', () => {
  it('returns an empty map for empty runs', () => {
    expect(computeFlakeScores([])).toEqual(new Map())
  })

  it('returns 0 for tests that never fail', () => {
    const runs = [
      makeRecord({
        all_tests: ['a.test.ts', 'b.test.ts'],
        actual_failures: [],
      }),
    ]
    const scores = computeFlakeScores(runs)
    expect(scores.get('a.test.ts')).toBe(0)
    expect(scores.get('b.test.ts')).toBe(0)
  })

  it('returns 1.0 for tests that always fail', () => {
    const runs = [
      makeRecord({
        all_tests: ['a.test.ts'],
        actual_failures: ['a.test.ts'],
      }),
      makeRecord({
        all_tests: ['a.test.ts'],
        actual_failures: ['a.test.ts'],
      }),
    ]
    const scores = computeFlakeScores(runs)
    expect(scores.get('a.test.ts')).toBe(1.0)
  })

  it('computes correct fractional score', () => {
    const runs = [
      makeRecord({
        all_tests: ['a.test.ts'],
        actual_failures: ['a.test.ts'],
      }),
      makeRecord({
        all_tests: ['a.test.ts'],
        actual_failures: [],
      }),
      makeRecord({
        all_tests: ['a.test.ts'],
        actual_failures: [],
      }),
      makeRecord({
        all_tests: ['a.test.ts'],
        actual_failures: ['a.test.ts'],
      }),
    ]
    const scores = computeFlakeScores(runs)
    expect(scores.get('a.test.ts')).toBe(0.5) // 2/4
  })
})
