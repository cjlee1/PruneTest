/**
 * Unit tests for dashboard/src/lib/queries.ts
 * Mocks @clickhouse/client-web to avoid real network calls.
 */

const mockQuery = jest.fn()

// Must mock before importing the module under test
jest.mock('@clickhouse/client-web', () => ({
  createClient: jest.fn(() => ({
    query: mockQuery,
  })),
}))

import {
  getShadowProgress,
  getFlakyLeaderboard,
  getAccuracyTrend,
  getSavingsTrend,
  getRecentRecall,
  getRecentRuns,
} from '../lib/queries'

afterEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// getShadowProgress
// ---------------------------------------------------------------------------
describe('getShadowProgress', () => {
  it('happy path: coerces string fields to numbers', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([{ run_count: '42', avg_skip_pct: '0.35' }]),
    })

    const result = await getShadowProgress('org/repo')
    expect(result).toEqual({ run_count: 42, avg_skip_pct: 0.35 })
    expect(typeof result.run_count).toBe('number')
    expect(typeof result.avg_skip_pct).toBe('number')
  })

  it('empty result: returns zeroed struct', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([]),
    })

    const result = await getShadowProgress('org/repo')
    expect(result).toEqual({ run_count: 0, avg_skip_pct: 0 })
  })

  it('ClickHouse error: fails open and logs with correct prefix', async () => {
    mockQuery.mockRejectedValueOnce(new Error('ClickHouse connection refused'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const result = await getShadowProgress('org/repo')

    expect(result).toEqual({ run_count: 0, avg_skip_pct: 0 })
    expect(consoleSpy).toHaveBeenCalledWith(
      '[queries] getShadowProgress error:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// getFlakyLeaderboard
// ---------------------------------------------------------------------------
describe('getFlakyLeaderboard', () => {
  it('happy path: coerces numeric string fields to numbers', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([
        { test_path: 'tests/auth.test.ts', flake_score: '0.12', total_runs: '100' },
      ]),
    })

    const result = await getFlakyLeaderboard('org/repo')
    expect(result).toEqual([
      { test_path: 'tests/auth.test.ts', flake_score: 0.12, total_runs: 100 },
    ])
    expect(typeof result[0].flake_score).toBe('number')
    expect(typeof result[0].total_runs).toBe('number')
  })

  it('empty result: returns empty array', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([]),
    })

    const result = await getFlakyLeaderboard('org/repo')
    expect(result).toEqual([])
  })

  it('ClickHouse error: fails open and logs with correct prefix', async () => {
    mockQuery.mockRejectedValueOnce(new Error('ClickHouse timeout'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const result = await getFlakyLeaderboard('org/repo')

    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith(
      '[queries] getFlakyLeaderboard error:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// getAccuracyTrend
// ---------------------------------------------------------------------------
describe('getAccuracyTrend', () => {
  it('happy path: coerces numeric string fields to numbers', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([
        {
          week: '2024-01-07',
          runs_with_failures: '5',
          missed_failures: '2',
          total_failures: '8',
        },
      ]),
    })

    const result = await getAccuracyTrend('org/repo')
    expect(result).toEqual([
      {
        week: '2024-01-07',
        runs_with_failures: 5,
        missed_failures: 2,
        total_failures: 8,
      },
    ])
    expect(typeof result[0].runs_with_failures).toBe('number')
    expect(typeof result[0].missed_failures).toBe('number')
    expect(typeof result[0].total_failures).toBe('number')
  })

  it('empty result: returns empty array', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([]),
    })

    const result = await getAccuracyTrend('org/repo')
    expect(result).toEqual([])
  })

  it('ClickHouse error: fails open and logs with correct prefix', async () => {
    mockQuery.mockRejectedValueOnce(new Error('ClickHouse query failed'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const result = await getAccuracyTrend('org/repo')

    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith(
      '[queries] getAccuracyTrend error:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// getSavingsTrend
// ---------------------------------------------------------------------------
describe('getSavingsTrend', () => {
  it('happy path: coerces numeric string field to number', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([
        { week: '2024-01-07', minutes_saved: '73.5' },
      ]),
    })

    const result = await getSavingsTrend('org/repo')
    expect(result).toEqual([{ week: '2024-01-07', minutes_saved: 73.5 }])
    expect(typeof result[0].minutes_saved).toBe('number')
  })

  it('empty result: returns empty array', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([]),
    })

    const result = await getSavingsTrend('org/repo')
    expect(result).toEqual([])
  })

  it('ClickHouse error: fails open and logs with correct prefix', async () => {
    mockQuery.mockRejectedValueOnce(new Error('ClickHouse unavailable'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const result = await getSavingsTrend('org/repo')

    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith(
      '[queries] getSavingsTrend error:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// getRecentRecall
// ---------------------------------------------------------------------------
describe('getRecentRecall', () => {
  it('happy path: computes recall correctly from ClickHouse rows', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([{ missed: '2', total_failures: '20' }]),
    })

    const result = await getRecentRecall('org/repo')
    // recall = (20 - 2) / 20 = 0.9
    expect(result).toEqual({ recall: 0.9, total_failures: 20 })
    expect(typeof result.recall).toBe('number')
    expect(typeof result.total_failures).toBe('number')
  })

  it('no failures: returns recall=1.0 (not NaN) when total_failures=0', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([{ missed: '0', total_failures: '0' }]),
    })

    const result = await getRecentRecall('org/repo')
    expect(result).toEqual({ recall: 1.0, total_failures: 0 })
    expect(Number.isNaN(result.recall)).toBe(false)
  })

  it('empty result: returns recall=1.0, total_failures=0', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([]),
    })

    const result = await getRecentRecall('org/repo')
    expect(result).toEqual({ recall: 1.0, total_failures: 0 })
  })

  it('ClickHouse error: fails open, returns { recall: 1.0, total_failures: 0 }, logs correct prefix', async () => {
    mockQuery.mockRejectedValueOnce(new Error('ClickHouse connection refused'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const result = await getRecentRecall('org/repo')

    expect(result).toEqual({ recall: 1.0, total_failures: 0 })
    expect(consoleSpy).toHaveBeenCalledWith(
      '[queries] getRecentRecall error:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })

  it('passes custom n parameter to the query', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([{ missed: '1', total_failures: '10' }]),
    })

    await getRecentRecall('org/repo', 50)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query_params: expect.objectContaining({ n: 50 }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// getRecentRuns
// ---------------------------------------------------------------------------
describe('getRecentRuns', () => {
  it('happy path: coerces string fields to correct types', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([
        {
          pr_number: '101',
          sha: 'abc1234',
          mode: 'shadow',
          created_at: '2024-03-01T12:00:00Z',
          skip_pct: '0.42',
          failure_count: '3',
        },
        {
          pr_number: '100',
          sha: 'def5678',
          mode: 'shadow',
          created_at: '2024-02-28T08:00:00Z',
          skip_pct: '0.10',
          failure_count: '0',
        },
      ]),
    })

    const result = await getRecentRuns('org/repo')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      pr_number: 101,
      sha: 'abc1234',
      mode: 'shadow',
      created_at: '2024-03-01T12:00:00Z',
      skip_pct: 0.42,
      failure_count: 3,
    })
    expect(typeof result[0].pr_number).toBe('number')
    expect(typeof result[0].skip_pct).toBe('number')
    expect(typeof result[0].failure_count).toBe('number')
  })

  it('empty result: returns empty array', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([]),
    })

    const result = await getRecentRuns('org/repo')
    expect(result).toEqual([])
  })

  it('ClickHouse error: fails open and logs with correct prefix', async () => {
    mockQuery.mockRejectedValueOnce(new Error('ClickHouse unavailable'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const result = await getRecentRuns('org/repo')

    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith(
      '[queries] getRecentRuns error:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })

  it('passes custom n parameter to the query', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([]),
    })

    await getRecentRuns('org/repo', 5)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query_params: expect.objectContaining({ n: 5 }),
      }),
    )
  })
})
