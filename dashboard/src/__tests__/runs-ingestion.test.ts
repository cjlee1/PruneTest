/**
 * Unit tests for POST /api/runs route handler.
 * Uses handleRunsPost() with injected mock dependencies for full branch coverage.
 */

// Hoist mocks before any imports
const mockQuery = jest.fn()
const mockInsert = jest.fn()

jest.mock('@clickhouse/client-web', () => ({
  createClient: jest.fn(() => ({
    query: mockQuery,
    insert: mockInsert,
  })),
}))

jest.mock('../lib/db/index', () => ({
  db: {
    select: jest.fn(),
  },
  schema: {},
}))

jest.mock('drizzle-orm', () => ({
  eq: jest.fn((_col: unknown, val: unknown) => val),
}))

import { handleRunsPost } from '../lib/handlers/runs'
import type { RunRecord } from '../../../shared/types'
import type { ApiToken } from '../lib/db/schema'

// ─── Test fixtures ───────────────────────────────────────────────────────────

const validBody: RunRecord = {
  id: 'run-abc-123',
  repo_id: 'org/repo',
  pr_number: 42,
  sha: 'deadbeef',
  predicted_skip: ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'],
  actual_failures: [],
  all_tests: ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts', 'tests/d.test.ts'],
  mode: 'shadow',
  created_at: new Date('2024-01-15T12:00:00.000Z'),
}

const activeTokenRow: ApiToken = {
  id: 'uuid-token-1',
  tokenHash: 'hashed-value',
  repoId: 'org/repo',
  plan: 'free',
  active: true,
  createdAt: new Date(),
}

// Mock injected dependencies
const mockTokenLookup = jest.fn<Promise<ApiToken | null>, [string]>()
const mockRunChecker = jest.fn<Promise<boolean>, [string, string]>()
const mockRunInserter = jest.fn<Promise<void>, [Parameters<typeof import('../lib/runs').insertRun>[0]]>()

function makePost(
  body: unknown = validBody,
  authHeader: string | null = 'Bearer valid-token',
) {
  return handleRunsPost(body, authHeader, mockTokenLookup, mockRunChecker, mockRunInserter)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('handleRunsPost — auth checks', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when Authorization header is missing', async () => {
    const result = await makePost(validBody, null)
    expect(result.status).toBe(401)
    expect(mockTokenLookup).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header lacks "Bearer " prefix', async () => {
    const result = await makePost(validBody, 'Token some-other-scheme')
    expect(result.status).toBe(401)
    expect(mockTokenLookup).not.toHaveBeenCalled()
  })

  it('returns 401 when lookupToken returns null (unknown token)', async () => {
    mockTokenLookup.mockResolvedValueOnce(null)

    const result = await makePost(validBody, 'Bearer unknown-token')
    expect(result.status).toBe(401)
  })

  it('returns 401 when token row has active=false', async () => {
    const inactiveRow: ApiToken = { ...activeTokenRow, active: false }
    mockTokenLookup.mockResolvedValueOnce(inactiveRow)

    const result = await makePost(validBody, 'Bearer inactive-token')
    expect(result.status).toBe(401)
  })
})

describe('handleRunsPost — repo_id binding', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('returns 403 when body.repo_id does not match token.repoId', async () => {
    const wrongRepoToken: ApiToken = { ...activeTokenRow, repoId: 'other-org/other-repo' }
    mockTokenLookup.mockResolvedValueOnce(wrongRepoToken)

    const result = await makePost(validBody, 'Bearer valid-token')
    expect(result.status).toBe(403)
  })
})

describe('handleRunsPost — body validation', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('returns 400 when body is missing the id field', async () => {
    mockTokenLookup.mockResolvedValueOnce(activeTokenRow)

    const bodyMissingId = { ...validBody, id: undefined }
    const result = await makePost(bodyMissingId, 'Bearer valid-token')
    expect(result.status).toBe(400)
  })

  it('returns 400 when mode is an invalid value', async () => {
    mockTokenLookup.mockResolvedValueOnce(activeTokenRow)

    const bodyBadMode = { ...validBody, mode: 'turbo' }
    const result = await makePost(bodyBadMode, 'Bearer valid-token')
    expect(result.status).toBe(400)
  })
})

describe('handleRunsPost — dedup and insert', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('returns 200 with status "duplicate" when run already exists', async () => {
    mockTokenLookup.mockResolvedValueOnce(activeTokenRow)
    mockRunChecker.mockResolvedValueOnce(true)

    const result = await makePost(validBody, 'Bearer valid-token')
    expect(result.status).toBe(200)
    expect((result.body as { status: string }).status).toBe('duplicate')
    expect(mockRunInserter).not.toHaveBeenCalled()
  })

  it('returns 201 with status "created" on first insert', async () => {
    mockTokenLookup.mockResolvedValueOnce(activeTokenRow)
    mockRunChecker.mockResolvedValueOnce(false)
    mockRunInserter.mockResolvedValueOnce(undefined)

    const result = await makePost(validBody, 'Bearer valid-token')
    expect(result.status).toBe(201)
    expect((result.body as { status: string }).status).toBe('created')
  })

  it('computes time_saved_minutes = predicted_skip.length × 0.5', async () => {
    mockTokenLookup.mockResolvedValueOnce(activeTokenRow)
    mockRunChecker.mockResolvedValueOnce(false)
    mockRunInserter.mockResolvedValueOnce(undefined)

    await makePost(validBody, 'Bearer valid-token')

    expect(mockRunInserter).toHaveBeenCalledTimes(1)
    const insertArg = mockRunInserter.mock.calls[0][0]
    // validBody.predicted_skip has 3 items → 3 × 0.5 = 1.5
    expect(insertArg.time_saved_minutes).toBe(1.5)
  })

  it('returns 500 when runInserter throws', async () => {
    mockTokenLookup.mockResolvedValueOnce(activeTokenRow)
    mockRunChecker.mockResolvedValueOnce(false)
    mockRunInserter.mockRejectedValueOnce(new Error('ClickHouse unavailable'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const result = await makePost(validBody, 'Bearer valid-token')
    consoleSpy.mockRestore()

    expect(result.status).toBe(500)
    expect((result.body as { status: string }).status).toBe('error')
  })

  it('calls alerter once with body.repo_id when insert succeeds (201)', async () => {
    mockTokenLookup.mockResolvedValueOnce(activeTokenRow)
    mockRunChecker.mockResolvedValueOnce(false)
    mockRunInserter.mockResolvedValueOnce(undefined)

    const mockAlerter = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined)
    const result = await handleRunsPost(
      validBody,
      'Bearer valid-token',
      mockTokenLookup,
      mockRunChecker,
      mockRunInserter,
      mockAlerter,
    )

    expect(result.status).toBe(201)
    expect(mockAlerter).toHaveBeenCalledTimes(1)
    expect(mockAlerter).toHaveBeenCalledWith(validBody.repo_id)
  })
})
