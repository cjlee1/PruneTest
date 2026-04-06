/**
 * Unit tests for GET /api/accuracy route handler.
 * Uses handleAccuracyGet() with injected mock dependencies.
 */

// Hoist mocks before any imports
const mockQuery = jest.fn()

jest.mock('@clickhouse/client-web', () => ({
  createClient: jest.fn(() => ({ query: mockQuery })),
}))

jest.mock('../lib/db/index', () => ({
  db: { select: jest.fn() },
  schema: {},
}))

jest.mock('drizzle-orm', () => ({
  eq: jest.fn((_: unknown, v: unknown) => v),
}))

import { handleAccuracyGet } from '../lib/handlers/accuracy'
import type { ApiToken } from '../lib/db/schema'
import type { AccuracyRow } from '../lib/queries'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const activeTokenRow: ApiToken = {
  id: 'uuid-1',
  tokenHash: 'hashed',
  repoId: 'org/repo',
  plan: 'free',
  active: true,
  createdAt: new Date(),
}

const mockTokenLookup = jest.fn<Promise<ApiToken | null>, [string]>()
const mockQueryFn = jest.fn<Promise<AccuracyRow[]>, [string]>()

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('handleAccuracyGet', () => {
  afterEach(() => jest.clearAllMocks())

  it('returns 401 when token is null', async () => {
    const result = await handleAccuracyGet(null, mockTokenLookup, mockQueryFn)
    expect(result.status).toBe(401)
    expect(mockTokenLookup).not.toHaveBeenCalled()
  })

  it('returns 401 when lookupToken returns null', async () => {
    mockTokenLookup.mockResolvedValueOnce(null)
    const result = await handleAccuracyGet('raw-token', mockTokenLookup, mockQueryFn)
    expect(result.status).toBe(401)
    expect(mockQueryFn).not.toHaveBeenCalled()
  })

  it('returns 200 with array body when token is valid and active', async () => {
    const rows: AccuracyRow[] = [
      { week: '2024-01-01', runs_with_failures: 2, missed_failures: 1, total_failures: 5 },
    ]
    mockTokenLookup.mockResolvedValueOnce(activeTokenRow)
    mockQueryFn.mockResolvedValueOnce(rows)

    const result = await handleAccuracyGet('raw-token', mockTokenLookup, mockQueryFn)
    expect(result.status).toBe(200)
    expect(Array.isArray(result.body)).toBe(true)
  })
})
