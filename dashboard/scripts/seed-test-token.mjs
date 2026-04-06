#!/usr/bin/env node
// One-off dev script: insert a known test token into Neon api_tokens table.
// Usage: node dashboard/scripts/seed-test-token.mjs
// Env: NEON_DATABASE_URL

import { createHash } from 'crypto'
import { neon } from '@neondatabase/serverless'

const RAW_TOKEN = 'test-token-s01'
const REPO_ID   = 'test-repo'

const url = process.env.NEON_DATABASE_URL
if (!url) {
  console.error('[seed-token] NEON_DATABASE_URL not set')
  process.exit(1)
}

function hashToken(raw) {
  return createHash('sha256').update(raw).digest('hex')
}

const sql = neon(url)
const hash = hashToken(RAW_TOKEN)

try {
  await sql`
    INSERT INTO api_tokens (token_hash, repo_id, plan, active)
    VALUES (${hash}, ${REPO_ID}, 'free', true)
    ON CONFLICT (token_hash) DO NOTHING
  `
  console.log(`[seed-token] inserted token for repo_id=${REPO_ID} (hash=${hash.slice(0, 12)}...)`)
} catch (err) {
  console.error('[seed-token] error:', err)
  process.exit(1)
}
