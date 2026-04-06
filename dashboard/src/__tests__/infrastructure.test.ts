/**
 * Smoke tests for dashboard infrastructure utilities.
 * These tests verify module shape without making real network calls.
 */

// Mock @neondatabase/serverless before importing db
jest.mock('@neondatabase/serverless', () => ({
  neon: jest.fn(() => jest.fn()),
}))

jest.mock('drizzle-orm/neon-http', () => ({
  drizzle: jest.fn(() => ({
    execute: jest.fn().mockResolvedValue([{ 1: 1 }]),
  })),
}))

jest.mock('@clickhouse/client-web', () => ({
  createClient: jest.fn(() => ({
    query: jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue([{ 1: 1 }]),
    }),
  })),
}))

describe('dashboard infrastructure', () => {
  describe('db/schema', () => {
    it('exports apiTokens and alertState table definitions', async () => {
      const { apiTokens, alertState } = await import('@/lib/db/schema')
      expect(apiTokens).toBeDefined()
      expect(alertState).toBeDefined()
    })
  })

  describe('clickhouse', () => {
    it('exports pingClickHouse as a function', async () => {
      const { pingClickHouse } = await import('@/lib/clickhouse')
      expect(typeof pingClickHouse).toBe('function')
    })

    it('pingClickHouse returns true when query succeeds', async () => {
      const { pingClickHouse } = await import('@/lib/clickhouse')
      const result = await pingClickHouse()
      expect(result).toBe(true)
    })

    it('pingClickHouse returns false on error', async () => {
      const { createClient } = await import('@clickhouse/client-web')
      const mockCreate = createClient as jest.MockedFunction<typeof createClient>
      // Override mock to throw
      mockCreate.mockReturnValueOnce({
        query: jest.fn().mockRejectedValue(new Error('connection refused')),
      } as unknown as ReturnType<typeof createClient>)

      // Re-import to get new instance — use isolated module reset
      jest.resetModules()

      jest.mock('@clickhouse/client-web', () => ({
        createClient: jest.fn(() => ({
          query: jest.fn().mockRejectedValue(new Error('connection refused')),
        })),
      }))

      const { pingClickHouse: ping } = await import('@/lib/clickhouse')
      const result = await ping()
      expect(result).toBe(false)
    })
  })

  describe('db/index', () => {
    it('exports db object', async () => {
      const { db } = await import('@/lib/db')
      expect(db).toBeDefined()
    })
  })
})
