#!/usr/bin/env node
// One-off dev script: upsert an alert_state row for 'test-repo' in Neon Postgres.
// Usage: node dashboard/scripts/seed-alert-state.mjs
// Env (required): NEON_DATABASE_URL, ALERT_EMAIL
// Env (optional): SLACK_WEBHOOK_URL

import { neon } from '@neondatabase/serverless'

const databaseUrl = process.env.NEON_DATABASE_URL
const alertEmail  = process.env.ALERT_EMAIL
const slackUrl    = process.env.SLACK_WEBHOOK_URL ?? null

if (!databaseUrl) {
  console.error('[seed-alert-state] NEON_DATABASE_URL is required')
  process.exit(1)
}
if (!alertEmail) {
  console.error('[seed-alert-state] ALERT_EMAIL is required')
  process.exit(1)
}

const sql = neon(databaseUrl)

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
  console.log('[seed-alert-state] upserted row:', rows[0])
  console.log('[seed-alert-state] done — alert_state ready for test-repo')
} catch (err) {
  console.error('[seed-alert-state] error:', err)
  process.exit(1)
}
