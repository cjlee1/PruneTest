#!/usr/bin/env node
// One-off dev script: insert three batches of RunRecords into ClickHouse for alert demo.
// Usage: node dashboard/scripts/seed-alert-runs.mjs
// Env: CLICKHOUSE_URL, CLICKHOUSE_USERNAME, CLICKHOUSE_PASSWORD
//
// Batch A (pr 1–5):  recall ~80% → triggers degradation alert
// Batch B (pr 6–10): recall 100% → triggers recovery
// Batch C (pr 11–15): recall ~80% → dedup test (no second alert should fire)

import { createClient } from '@clickhouse/client-web'
import { randomUUID } from 'crypto'

const url      = process.env.CLICKHOUSE_URL      ?? 'http://localhost:8123'
const username = process.env.CLICKHOUSE_USERNAME ?? 'default'
const password = process.env.CLICKHOUSE_PASSWORD ?? ''

const client = createClient({ url, username, password })

// Helper: insert a single run and log it
async function insertRun(run) {
  await client.insert({
    table: 'runs',
    values: [run],
    format: 'JSONEachRow',
  })
  console.log(
    `[seed-alert-runs] inserted pr=${run.pr_number} id=${run.id}`,
    `recall=${run.actual_failures.length > 0
      ? ((run.actual_failures.length - run.predicted_skip.filter(s => run.actual_failures.includes(s)).length) / run.actual_failures.length).toFixed(2)
      : 'n/a'}`,
  )
}

try {
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '')

  // ── Batch A: 5 runs at ~80% recall (1 miss out of 5 failures) ──────────
  console.log('[seed-alert-runs] inserting Batch A (pr 1–5, recall=0.80) ...')
  for (let i = 1; i <= 5; i++) {
    await insertRun({
      id:              randomUUID(),
      repo_id:         'test-repo',
      pr_number:       i,
      sha:             `batchA${String(i).padStart(3, '0')}`,
      actual_failures: ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts', 'test/e.test.ts'],
      predicted_skip:  ['test/a.test.ts'],   // misses a.test.ts → recall = 4/5 = 0.80
      all_tests:       ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts', 'test/e.test.ts'],
      mode:            'shadow',
      time_saved_minutes: 0.0,
      created_at:      now,
    })
  }
  console.log('[seed-alert-runs] Batch A done — expect degradation alert to fire')

  // ── Batch B: 5 runs at 100% recall (no misses) ─────────────────────────
  console.log('[seed-alert-runs] inserting Batch B (pr 6–10, recall=1.00) ...')
  for (let i = 6; i <= 10; i++) {
    await insertRun({
      id:              randomUUID(),
      repo_id:         'test-repo',
      pr_number:       i,
      sha:             `batchB${String(i).padStart(3, '0')}`,
      actual_failures: ['test/a.test.ts'],
      predicted_skip:  [],                   // no skips → no misses → recall = 1.0
      all_tests:       ['test/a.test.ts', 'test/b.test.ts'],
      mode:            'shadow',
      time_saved_minutes: 0.0,
      created_at:      now,
    })
  }
  console.log('[seed-alert-runs] Batch B done — expect recovery alert to fire')

  // ── Batch C: 5 more runs at ~80% recall (dedup — no second alert) ──────
  console.log('[seed-alert-runs] inserting Batch C (pr 11–15, recall=0.80) ...')
  for (let i = 11; i <= 15; i++) {
    await insertRun({
      id:              randomUUID(),
      repo_id:         'test-repo',
      pr_number:       i,
      sha:             `batchC${String(i).padStart(3, '0')}`,
      actual_failures: ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts', 'test/e.test.ts'],
      predicted_skip:  ['test/a.test.ts'],
      all_tests:       ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts', 'test/e.test.ts'],
      mode:            'shadow',
      time_saved_minutes: 0.0,
      created_at:      now,
    })
  }
  console.log('[seed-alert-runs] Batch C done — no second alert should fire (dedup)')

  console.log('[seed-alert-runs] all 15 runs inserted for repo_id=test-repo')
} catch (err) {
  console.error('[seed-alert-runs] error:', err)
  process.exit(1)
} finally {
  await client.close()
}
