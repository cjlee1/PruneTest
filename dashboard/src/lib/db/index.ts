import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

const url = process.env.NEON_DATABASE_URL

if (!url) {
  console.error('[db] NEON_DATABASE_URL is not set — database queries will fail')
}

const sql = neon(url ?? 'postgresql://localhost/neondb')
export const db = drizzle(sql, { schema })

export { schema }
export type { ApiToken, NewApiToken } from './schema'
