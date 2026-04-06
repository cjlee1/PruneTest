#!/usr/bin/env node
// End-to-end verification script for the S07 alert demo scenario.
//
// Drives the full flow: seed alert_state → POST 3 batches of runs →
// check dedup. Exits 0 if all POSTs return 200/201, exits 1 on any 4xx/5xx.
//
// Usage:
//   TEST_TOKEN=<bearer-token> \
//   NEON_DATABASE_URL=<postgres-url> \
//   ALERT_EMAIL=<email> \
//   [BASE_URL=http://localhost:3000] \
//   [SLACK_WEBHOOK_URL=<url>] \
//   node dashboard/scripts/test-alerts.mjs

import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'crypto'

// ── Env vars ─────────────────────────────────────────────────────────────────
const testToken    = process.env.TEST_TOKEN
const baseUrl      = process.env.BASE_URL ?? 'http://localhost:3000'
const databaseUrl  = process.env.NEON_DATABASE_URL
const alertEmail   = process.env.ALERT_EMAIL
const slackUrl     = process.env.SLACK_WEBHOOK_URL ?? null

if (!testToken) {
  console.error('[test-alerts] TEST_TOKEN is required (the bearer token for /api/runs)')
  process.exit(1)
}
if (!databaseUrl) {
  console.error('[test-alerts] NEON_DATABASE_URL is required')
  process.exit(1)
}
if (!alertEmail) {
  console.error('[test-alerts] ALERT_EMAIL is required')
  process.exit(1)
}

// ── Neon setup ────────────────────────────────────────────────────────────────
const sql = neon(databaseUrl)

// ── Step 1: Upsert + reset alert_state row ────────────────────────────────────
console.log('[test-alerts] step 1: seeding alert_state for test-repo ...')
try {
  const rows = await sql`
    INSERT INTO alert_state (repo_id, alert_email, slack_webhook_url, alert_fired_at, recovered_at)
    VALUES ('test-repo', ${alertEmail}, ${slackUrl}, NULL, NULL)
    ON CONFLICT (repo_id) DO UPDATE
      SET alert_email       = EXCLUDED.alert_email,
          slack_webhook_url = EXCLUDED.slack_webhook_url,
          alert_fired_at    = NULL,
          recovered_at      = NULL
    RETURNING *
  `
  console.log('[test-alerts] alert_state row:', rows[0])
} catch (err) {
  console.error('[test-alerts] failed to seed alert_state:', err)
  process.exit(1)
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
let allOk = true

async function postRun(run) {
  const url = `${baseUrl}/api/runs`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${testToken}`,
      },
      body: JSON.stringify(run),
    })
  } catch (err) {
    console.error(`  [POST ${url}] network error:`, err.message)
    allOk = false
    return
  }
  let bodyText = ''
  try {
    bodyText = await res.text()
  } catch {
    bodyText = '(unreadable)'
  }
  const ok = res.status === 200 || res.status === 201
  if (!ok) allOk = false
  console.log(`  [POST /api/runs] status=${res.status} body=${bodyText}`)
}

const now = new Date().toISOString()

// ── Batch A: 5 runs at ~80% recall → triggers degradation alert ──────────────
console.log('\n[test-alerts] step 2: posting Batch A (5 runs, recall=0.80) ...')
for (let i = 1; i <= 5; i++) {
  await postRun({
    id:               randomUUID(),
    repo_id:          'test-repo',
    pr_number:        i,
    sha:              `batchA${String(i).padStart(3, '0')}`,
    predicted_skip:   ['test/a.test.ts'],         // skips a — misses it → recall=4/5=0.80
    actual_failures:  ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts', 'test/e.test.ts'],
    all_tests:        ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts', 'test/e.test.ts'],
    mode:             'shadow',
    time_saved_minutes: 0.5,
    created_at:       now,
  })
}
console.log('\n>>> Check Resend dashboard and Slack channel — degradation alert should have fired.\n')

// ── Batch B: 5 recovery runs at 100% recall → triggers recovery ──────────────
console.log('[test-alerts] step 3: posting Batch B (5 runs, recall=1.00) ...')
for (let i = 6; i <= 10; i++) {
  await postRun({
    id:               randomUUID(),
    repo_id:          'test-repo',
    pr_number:        i,
    sha:              `batchB${String(i).padStart(3, '0')}`,
    predicted_skip:   [],                          // no skips → no misses → recall=1.0
    actual_failures:  ['test/a.test.ts'],
    all_tests:        ['test/a.test.ts', 'test/b.test.ts'],
    mode:             'shadow',
    time_saved_minutes: 0.5,
    created_at:       now,
  })
}
console.log('\n>>> Check Resend dashboard and Slack channel — recovery notification should have arrived.\n')

// ── Batch C: 5 more 80% runs → dedup check ───────────────────────────────────
console.log('[test-alerts] step 4: posting Batch C (5 runs, recall=0.80, dedup check) ...')
for (let i = 11; i <= 15; i++) {
  await postRun({
    id:               randomUUID(),
    repo_id:          'test-repo',
    pr_number:        i,
    sha:              `batchC${String(i).padStart(3, '0')}`,
    predicted_skip:   ['test/a.test.ts'],
    actual_failures:  ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts', 'test/e.test.ts'],
    all_tests:        ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts', 'test/e.test.ts'],
    mode:             'shadow',
    time_saved_minutes: 0.5,
    created_at:       now,
  })
}
console.log('\n>>> No second degradation alert should fire (dedup). Check that no new email/Slack message arrived.\n')

// ── Exit code ─────────────────────────────────────────────────────────────────
if (allOk) {
  console.log('[test-alerts] ✅ all 15 POSTs succeeded (200 or 201)')
  process.exit(0)
} else {
  console.error('[test-alerts] ❌ one or more POSTs returned an error status — see output above')
  process.exit(1)
}
