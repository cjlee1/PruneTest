/**
 * Unit tests for GET /api/flaky route handler.
 * Uses handleFlakyGet() with injected mock dependencies.
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

import { handleFlakyGet } from '../lib/handlers/flaky'
import type { ApiToken } from '../lib/db/schema'
import type { FlakyRow } from '../lib/queries'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const activeTokenRow: ApiToken = {
  id: 'uuid-1',
  tokenHash: 'hashed',
  repoId: 'org/repo',
  plan: 'free',
  active: true,
  createdAt: new Date(),
}

const inactiveTokenRow: ApiToken = { ...activeTokenRow, active: false }

const mockTokenLookup = jest.fn<Promise<ApiToken | null>, [string]>()
const mockQueryFn = jest.fn<Promise<FlakyRow[]>, [string]>()

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('handleFlakyGet', () => {
  afterEach(() => jest.clearAllMocks())

  it('returns 401 when token is null', async () => {
    const result = await handleFlakyGet(null, mockTokenLookup, mockQueryFn)
    expect(result.status).toBe(401)
    expect(mockTokenLookup).not.toHaveBeenCalled()
  })

  it('returns 401 when lookupToken returns null', async () => {
    mockTokenLookup.mockResolvedValueOnce(null)
    const result = await handleFlakyGet('raw-token', mockTokenLookup, mockQueryFn)
    expect(result.status).toBe(401)
    expect(mockQueryFn).not.toHaveBeenCalled()
  })

  it('returns 401 when token is inactive', async () => {
    mockTokenLookup.mockResolvedValueOnce(inactiveTokenRow)
    const result = await handleFlakyGet('raw-token', mockTokenLookup, mockQueryFn)
    expect(result.status).toBe(401)
    expect(mockQueryFn).not.toHaveBeenCalled()
  })

  it('returns 200 with array body where first element has numeric flake_score', async () => {
    const rows: FlakyRow[] = [
      { test_path: 'tests/auth.test.ts', flake_score: 0.42, total_runs: 20 },
      { test_path: 'tests/login.test.ts', flake_score: 0.1, total_runs: 10 },
    ]
    mockTokenLookup.mockResolvedValueOnce(activeTokenRow)
    mockQueryFn.mockResolvedValueOnce(rows)

    const result = await handleFlakyGet('raw-token', mockTokenLookup, mockQueryFn)
    expect(result.status).toBe(200)
    expect(Array.isArray(result.body)).toBe(true)
    const body = result.body as FlakyRow[]
    expect(body[0]).toMatchObject({ test_path: expect.any(String), flake_score: expect.any(Number), total_runs: expect.any(Number) })
    expect(typeof body[0].flake_score).toBe('number')
  })
})
