#!/usr/bin/env node
// Dev script: inspect the five most recent api_tokens rows in Neon.
// Usage: node dashboard/scripts/verify-tokens.mjs
// Env: NEON_DATABASE_URL (loaded from dashboard/.env.local by the caller)

import { neon } from '@neondatabase/serverless'

const url = process.env.NEON_DATABASE_URL
if (!url) {
  console.error('[verify-tokens] NEON_DATABASE_URL not set')
  process.exit(1)
}

const sql = neon(url)

try {
  const rows = await sql`
    SELECT token_hash, repo_id, plan, active, created_at
    FROM api_tokens
    ORDER BY created_at DESC
    LIMIT 5
  `
  console.log(JSON.stringify(rows, null, 2))
} catch (err) {
  console.error('[verify-tokens] query error:', err)
  process.exit(1)
}
