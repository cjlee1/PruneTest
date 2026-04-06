import { createHash } from 'crypto'

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

import { hashToken, lookupToken } from '../lib/token'
import { db } from '../lib/db/index'

const mockDb = db as jest.Mocked<typeof db>

// Helper to build a fake builder chain that resolves to an array
function makeQueryChain(result: unknown[]) {
  const chain = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(result),
  }
  return chain
}

describe('hashToken', () => {
  it('returns SHA-256 hex digest of the input', () => {
    const raw = 'my-secret-token'
    const expected = createHash('sha256').update(raw).digest('hex')
    expect(hashToken(raw)).toBe(expected)
  })

  it('produces a 64-char hex string', () => {
    const result = hashToken('abc')
    expect(result).toHaveLength(64)
    expect(result).toMatch(/^[0-9a-f]+$/)
  })

  it('handles empty string without throwing', () => {
    expect(() => hashToken('')).not.toThrow()
    expect(hashToken('')).toHaveLength(64)
  })

  it('handles SQL-special characters safely (hash only, no injection risk)', () => {
    const sqlInput = "'; DROP TABLE api_tokens; --"
    const result = hashToken(sqlInput)
    expect(result).toHaveLength(64)
    expect(result).toMatch(/^[0-9a-f]+$/)
  })
})

describe('lookupToken', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('returns the token row when the hash exists in the DB', async () => {
    const fakeRow = {
      id: 'uuid-1',
      tokenHash: 'abc123hash',
      repoId: 'org/repo',
      plan: 'free',
      active: true,
      createdAt: new Date(),
    }
    const mockSelect = mockDb.select as jest.Mock
    mockSelect.mockReturnValue(makeQueryChain([fakeRow]))

    const result = await lookupToken('abc123hash')
    expect(result).toEqual(fakeRow)
  })

  it('returns null when the hash is not in the DB', async () => {
    const mockSelect = mockDb.select as jest.Mock
    mockSelect.mockReturnValue(makeQueryChain([]))

    const result = await lookupToken('unknownhash')
    expect(result).toBeNull()
  })

  it('returns null on DB error (fail-secure)', async () => {
    const mockSelect = mockDb.select as jest.Mock
    mockSelect.mockImplementation(() => {
      throw new Error('DB connection failed')
    })

    const result = await lookupToken('somehash')
    expect(result).toBeNull()
  })
})

// Thin wrapper that exercises the same logic as the page component
// without importing the RSC page (which would require full Next.js runtime)
async function tokenPageLogic(
  rawToken: string,
  lookup: (hash: string) => Promise<{ repoId: string; active: boolean } | null>,
  notFoundFn: () => never,
): Promise<{ repoId: string } | null> {
  const hash = hashToken(rawToken)
  const row = await lookup(hash)
  if (!row || !row.active) {
    notFoundFn()
  }
  return row as { repoId: string }
}

describe('token page logic (notFound behaviour)', () => {
  afterEach(() => {
    jest.clearAllMocks()
    mockNotFound.mockClear()
  })

  it('does NOT call notFound when DB returns an active row', async () => {
    const fakeRow = { repoId: 'org/repo', active: true }
    const lookup = jest.fn().mockResolvedValue(fakeRow)
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)

    const result = await tokenPageLogic('valid-token', lookup, notFoundSpy)
    expect(notFoundSpy).not.toHaveBeenCalled()
    expect(result).toEqual(fakeRow)
  })

  it('calls notFound when DB returns null (token not found)', async () => {
    const lookup = jest.fn().mockResolvedValue(null)
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)

    await expect(tokenPageLogic('bad-token', lookup, notFoundSpy)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFoundSpy).toHaveBeenCalledTimes(1)
  })

  it('calls notFound when the row exists but active=false', async () => {
    const inactiveRow = { repoId: 'org/repo', active: false }
    const lookup = jest.fn().mockResolvedValue(inactiveRow)
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)

    await expect(tokenPageLogic('inactive-token', lookup, notFoundSpy)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFoundSpy).toHaveBeenCalledTimes(1)
  })

  it('calls notFound for empty string token when DB returns null', async () => {
    const lookup = jest.fn().mockResolvedValue(null)
    const notFoundSpy = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) as jest.Mock & (() => never)

    await expect(tokenPageLogic('', lookup, notFoundSpy)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFoundSpy).toHaveBeenCalledTimes(1)
  })
})
