#!/usr/bin/env node
/**
 * provision-token.mjs — Self-serve API token provisioning.
 *
 * Open-source replacement for the Stripe-based token workflow.
 * Creates a SHA-256-hashed token in Neon and prints the raw token once.
 *
 * Usage:
 *   NEON_DATABASE_URL=<url> REPO_ID=org/repo [PLAN=free] \
 *     node dashboard/scripts/provision-token.mjs
 */

import { createHash, randomUUID } from 'crypto'
import { neon } from '@neondatabase/serverless'

const url = process.env.NEON_DATABASE_URL
const repoId = process.env.REPO_ID
const plan = process.env.PLAN ?? 'free'

if (!url) {
  console.error('[provision-token] NEON_DATABASE_URL is required')
  process.exit(1)
}
if (!repoId) {
  console.error('[provision-token] REPO_ID is required  (e.g. REPO_ID=org/repo)')
  process.exit(1)
}

const sql = neon(url)

const rawToken = randomUUID()
const tokenHash = createHash('sha256').update(rawToken).digest('hex')

try {
  await sql`
    INSERT INTO api_tokens (token_hash, repo_id, plan, active)
    VALUES (${tokenHash}, ${repoId}, ${plan}, true)
  `
  console.log('')
  console.log('✅  Token provisioned successfully.')
  console.log('')
  console.log('  repo_id :', repoId)
  console.log('  plan    :', plan)
  console.log('')
  console.log('  ┌─────────────────────────────────────────────────────────────────────┐')
  console.log('  │  RAW TOKEN (shown once — copy it now and keep it safe)              │')
  console.log('  │                                                                     │')
  console.log(`  │  ${rawToken}  │`)
  console.log('  │                                                                     │')
  console.log('  └─────────────────────────────────────────────────────────────────────┘')
  console.log('')
  console.log('  Set TESTSELECTOR_TOKEN=<raw-token> in your CI environment.')
  console.log('')
} catch (err) {
  console.error('[provision-token] DB error:', err)
  process.exit(1)
}
