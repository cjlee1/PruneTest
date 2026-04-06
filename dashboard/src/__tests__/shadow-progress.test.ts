// Mock the DB module before importing token functions
jest.mock('../lib/db/index', () => ({
  db: {
    select: jest.fn(),
  },
  schema: {},
}))

// Mock drizzle-orm eq so it doesn't try to connect
jest.mock('drizzle-orm', () => ({
  eq: jest.fn((_col: unknown, val: unknown) => val),
}))

// Mock next/navigation
const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
jest.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}))

// Mock ClickHouse client
jest.mock('@clickhouse/client-web', () => ({
  createClient: jest.fn(() => ({
    query: jest.fn(),
  })),
}))

import { hashToken } from '../lib/token'
import type { ShadowProgress, RecentRunRow } from '../lib/queries'

// Pure function mirroring the shadow progress page logic
async function shadowProgressPageLogic(
  rawToken: string,
  lookup: (hash: string) => Promise<{ repoId: string; active: boolean } | null>,
  queryFn: (repoId: string) => Promise<ShadowProgress>,
  notFoundFn: () => never,
  recentRunsFn: (repoId: string) => Promise<RecentRunRow[]>,
): Promise<{ repoId: string; data: ShadowProgress; recentRuns: RecentRunRow[] }> {
  const hash = hashToken(rawToken)
  const row = await lookup(hash)
  if (!row || !row.active) {
    notFoundFn()
  }
  const data = await queryFn((row as { repoId: string; active: boolean }).repoId)
  const recentRuns = await recentRunsFn((row as { repoId: string; active: boolean }).repoId)
  return { repoId: (row as { repoId: string; active: boolean }).repoId, data, recentRuns }
}

describe('shadowProgressPageLogic', () => {
  afterEach(() => {
    jest.clearAllMocks()
    mockNotFound.mockClear()
  })

  it('calls notFound when lookup returns null', async () => {
    const lookup = jest.fn().mockResolvedValue(null)
    const queryFn = jest.fn()
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)
    const recentRunsFn = jest.fn().mockResolvedValue([])

    await expect(shadowProgressPageLogic('bad-token', lookup, queryFn, notFoundSpy, recentRunsFn)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFoundSpy).toHaveBeenCalledTimes(1)
    expect(queryFn).not.toHaveBeenCalled()
  })

  it('calls notFound when token row has active=false', async () => {
    const inactiveRow = { repoId: 'org/repo', active: false }
    const lookup = jest.fn().mockResolvedValue(inactiveRow)
    const queryFn = jest.fn()
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)
    const recentRunsFn = jest.fn().mockResolvedValue([])

    await expect(shadowProgressPageLogic('inactive-token', lookup, queryFn, notFoundSpy, recentRunsFn)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFoundSpy).toHaveBeenCalledTimes(1)
    expect(queryFn).not.toHaveBeenCalled()
  })

  it('returns repoId and data for a valid token with run data', async () => {
    const fakeRow = { repoId: 'org/repo', active: true }
    const fakeData: ShadowProgress = { run_count: 47, avg_skip_pct: 0.38 }
    const lookup = jest.fn().mockResolvedValue(fakeRow)
    const queryFn = jest.fn().mockResolvedValue(fakeData)
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)
    const recentRunsFn = jest.fn().mockResolvedValue([])

    const result = await shadowProgressPageLogic('valid-token', lookup, queryFn, notFoundSpy, recentRunsFn)
    expect(notFoundSpy).not.toHaveBeenCalled()
    expect(result.repoId).toBe('org/repo')
    expect(result.data).toEqual({ run_count: 47, avg_skip_pct: 0.38 })
    expect(result.recentRuns).toEqual([])
  })

  it('returns repoId and zero data for a valid token with no runs yet (empty state is render concern)', async () => {
    const fakeRow = { repoId: 'org/repo', active: true }
    const zeroData: ShadowProgress = { run_count: 0, avg_skip_pct: 0 }
    const lookup = jest.fn().mockResolvedValue(fakeRow)
    const queryFn = jest.fn().mockResolvedValue(zeroData)
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)
    const recentRunsFn = jest.fn().mockResolvedValue([])

    const result = await shadowProgressPageLogic('valid-token', lookup, queryFn, notFoundSpy, recentRunsFn)
    expect(notFoundSpy).not.toHaveBeenCalled()
    expect(result.repoId).toBe('org/repo')
    expect(result.data).toEqual({ run_count: 0, avg_skip_pct: 0 })
    expect(result.recentRuns).toEqual([])
  })

  it('returns recentRuns with 2 rows when recentRunsFn resolves with populated data', async () => {
    const fakeRow = { repoId: 'org/repo', active: true }
    const fakeData: ShadowProgress = { run_count: 10, avg_skip_pct: 0.5 }
    const fakeRuns: RecentRunRow[] = [
      { pr_number: 42, sha: 'abc1234', mode: 'shadow', created_at: '2025-01-01T00:00:00Z', skip_pct: 0.5, failure_count: 0 },
      { pr_number: 43, sha: 'def5678', mode: 'shadow', created_at: '2025-01-02T00:00:00Z', skip_pct: 0.3, failure_count: 1 },
    ]
    const lookup = jest.fn().mockResolvedValue(fakeRow)
    const queryFn = jest.fn().mockResolvedValue(fakeData)
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)
    const recentRunsFn = jest.fn().mockResolvedValue(fakeRuns)

    const result = await shadowProgressPageLogic('valid-token', lookup, queryFn, notFoundSpy, recentRunsFn)
    expect(notFoundSpy).not.toHaveBeenCalled()
    expect(result.recentRuns).toHaveLength(2)
    expect(result.recentRuns[0].pr_number).toBe(42)
    expect(result.recentRuns[1].failure_count).toBe(1)
  })

  it('returns empty recentRuns when run_count=0 and recentRunsFn resolves with empty array', async () => {
    const fakeRow = { repoId: 'org/repo', active: true }
    const zeroData: ShadowProgress = { run_count: 0, avg_skip_pct: 0 }
    const lookup = jest.fn().mockResolvedValue(fakeRow)
    const queryFn = jest.fn().mockResolvedValue(zeroData)
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)
    const recentRunsFn = jest.fn().mockResolvedValue([])

    const result = await shadowProgressPageLogic('valid-token', lookup, queryFn, notFoundSpy, recentRunsFn)
    expect(notFoundSpy).not.toHaveBeenCalled()
    expect(result.data.run_count).toBe(0)
    expect(result.recentRuns).toEqual([])
  })
})
