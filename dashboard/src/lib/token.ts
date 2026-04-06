import { createHash } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from './db/index'
import { apiTokens } from './db/schema'
import type { ApiToken } from './db/schema'

/**
 * Hashes a raw token string using SHA-256.
 * Raw tokens are never stored or logged — only the hex digest is persisted.
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Looks up an API token row by its hash.
 * Returns the row if found, null if not found or on any DB error (fail-secure).
 */
export async function lookupToken(hash: string): Promise<ApiToken | null> {
  try {
    const rows = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, hash))
      .limit(1)
    return rows[0] ?? null
  } catch (err) {
    console.error('[token] lookupToken error:', err instanceof Error ? err.message : String(err))
    return null
  }
}
