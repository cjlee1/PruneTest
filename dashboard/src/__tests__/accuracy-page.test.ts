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
import type { AccuracyRow } from '../lib/queries'

// Pure function mirroring the accuracy page logic
async function accuracyPageLogic(
  rawToken: string,
  lookup: (hash: string) => Promise<{ repoId: string; active: boolean } | null>,
  queryFn: (repoId: string) => Promise<AccuracyRow[]>,
  notFoundFn: () => never,
): Promise<{ repoId: string; rows: AccuracyRow[] }> {
  const hash = hashToken(rawToken)
  const row = await lookup(hash)
  if (!row || !row.active) {
    notFoundFn()
  }
  const rows = await queryFn((row as { repoId: string; active: boolean }).repoId)
  return { repoId: (row as { repoId: string; active: boolean }).repoId, rows }
}

describe('accuracyPageLogic', () => {
  afterEach(() => {
    jest.clearAllMocks()
    mockNotFound.mockClear()
  })

  it('calls notFound when lookup returns null', async () => {
    const lookup = jest.fn().mockResolvedValue(null)
    const queryFn = jest.fn()
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)

    await expect(accuracyPageLogic('bad-token', lookup, queryFn, notFoundSpy)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFoundSpy).toHaveBeenCalledTimes(1)
    expect(queryFn).not.toHaveBeenCalled()
  })

  it('calls notFound when token row has active=false', async () => {
    const inactiveRow = { repoId: 'org/repo', active: false }
    const lookup = jest.fn().mockResolvedValue(inactiveRow)
    const queryFn = jest.fn()
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)

    await expect(accuracyPageLogic('inactive-token', lookup, queryFn, notFoundSpy)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFoundSpy).toHaveBeenCalledTimes(1)
    expect(queryFn).not.toHaveBeenCalled()
  })

  it('returns repoId and rows for a valid token with accuracy data', async () => {
    const fakeRow = { repoId: 'org/repo', active: true }
    const fakeRows: AccuracyRow[] = [
      { week: '2024-01-01', runs_with_failures: 3, missed_failures: 1, total_failures: 5 },
    ]
    const lookup = jest.fn().mockResolvedValue(fakeRow)
    const queryFn = jest.fn().mockResolvedValue(fakeRows)
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)

    const result = await accuracyPageLogic('valid-token', lookup, queryFn, notFoundSpy)
    expect(notFoundSpy).not.toHaveBeenCalled()
    expect(result).toEqual({
      repoId: 'org/repo',
      rows: [{ week: '2024-01-01', runs_with_failures: 3, missed_failures: 1, total_failures: 5 }],
    })
  })

  it('returns repoId and empty rows for a valid token with no accuracy data', async () => {
    const fakeRow = { repoId: 'org/repo', active: true }
    const lookup = jest.fn().mockResolvedValue(fakeRow)
    const queryFn = jest.fn().mockResolvedValue([])
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)

    const result = await accuracyPageLogic('valid-token', lookup, queryFn, notFoundSpy)
    expect(notFoundSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ repoId: 'org/repo', rows: [] })
  })
})
