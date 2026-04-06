/**
 * Unit tests for dashboard/src/lib/runs.ts
 * Mocks @clickhouse/client-web to avoid real network calls.
 */

const mockQuery = jest.fn()
const mockInsert = jest.fn()

// Must mock before importing the module under test
jest.mock('@clickhouse/client-web', () => ({
  createClient: jest.fn(() => ({
    query: mockQuery,
    insert: mockInsert,
  })),
}))

import { checkRunExists, insertRun, RunInsert } from '../lib/runs'

const sampleRun: RunInsert = {
  id: 'run-abc-123',
  repo_id: 'org/repo',
  pr_number: 42,
  sha: 'deadbeef',
  predicted_skip: ['tests/a.test.ts', 'tests/b.test.ts'],
  actual_failures: [],
  all_tests: ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'],
  mode: 'shadow',
  time_saved_minutes: 1.0,
  created_at: '2024-01-15T12:00:00.000Z',
}

describe('checkRunExists', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('returns true when ClickHouse query returns matching rows', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([{ id: 'run-abc-123' }]),
    })

    const result = await checkRunExists('run-abc-123', 'org/repo')
    expect(result).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query_params: { run_id: 'run-abc-123', repo_id: 'org/repo' },
      }),
    )
  })

  it('returns false when ClickHouse query returns empty rows', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([]),
    })

    const result = await checkRunExists('nonexistent-run', 'org/repo')
    expect(result).toBe(false)
  })

  it('returns false on ClickHouse error (fail-open)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('ClickHouse connection refused'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const result = await checkRunExists('run-abc-123', 'org/repo')

    expect(result).toBe(false)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[runs] dedup check error:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })
})

describe('insertRun', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('calls chClient.insert with the correct run shape including time_saved_minutes', async () => {
    mockInsert.mockResolvedValueOnce(undefined)

    await insertRun(sampleRun)

    expect(mockInsert).toHaveBeenCalledWith({
      table: 'runs',
      values: [sampleRun],
      format: 'JSONEachRow',
    })
    // Verify time_saved_minutes is passed through correctly
    const callArg = mockInsert.mock.calls[0][0] as { values: RunInsert[] }
    expect(callArg.values[0].time_saved_minutes).toBe(1.0)
  })

  it('throws when ClickHouse insert fails', async () => {
    const insertError = new Error('ClickHouse insert failed')
    mockInsert.mockRejectedValueOnce(insertError)

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(insertRun(sampleRun)).rejects.toThrow('ClickHouse insert failed')
    consoleSpy.mockRestore()
  })
})
