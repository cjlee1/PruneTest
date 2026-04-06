/**
 * Unit tests for GET /api/savings route handler.
 * Uses handleSavingsGet() with injected mock dependencies.
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

import { handleSavingsGet } from '../lib/handlers/savings'
import type { ApiToken } from '../lib/db/schema'
import type { SavingsRow } from '../lib/queries'

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
const mockQueryFn = jest.fn<Promise<SavingsRow[]>, [string]>()

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('handleSavingsGet', () => {
  afterEach(() => jest.clearAllMocks())

  it('returns 401 when token is null', async () => {
    const result = await handleSavingsGet(null, mockTokenLookup, mockQueryFn)
    expect(result.status).toBe(401)
    expect(mockTokenLookup).not.toHaveBeenCalled()
  })

  it('returns 401 when lookupToken returns null', async () => {
    mockTokenLookup.mockResolvedValueOnce(null)
    const result = await handleSavingsGet('raw-token', mockTokenLookup, mockQueryFn)
    expect(result.status).toBe(401)
    expect(mockQueryFn).not.toHaveBeenCalled()
  })

  it('returns 200 with array body when token is valid and active', async () => {
    const rows: SavingsRow[] = [
      { week: '2024-01-01', minutes_saved: 45.5 },
    ]
    mockTokenLookup.mockResolvedValueOnce(activeTokenRow)
    mockQueryFn.mockResolvedValueOnce(rows)

    const result = await handleSavingsGet('raw-token', mockTokenLookup, mockQueryFn)
    expect(result.status).toBe(200)
    expect(Array.isArray(result.body)).toBe(true)
  })
})
