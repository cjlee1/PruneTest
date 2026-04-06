#!/usr/bin/env node
// One-off dev script: insert 5 synthetic RunRecords into ClickHouse runs table.
// Usage: node dashboard/scripts/seed-test-run.mjs
// Env: CLICKHOUSE_URL, CLICKHOUSE_USERNAME, CLICKHOUSE_PASSWORD

import { createClient } from '@clickhouse/client-web'
import { randomUUID } from 'crypto'

const url      = process.env.CLICKHOUSE_URL      ?? 'http://localhost:8123'
const username = process.env.CLICKHOUSE_USERNAME ?? 'default'
const password = process.env.CLICKHOUSE_PASSWORD ?? ''

const client = createClient({ url, username, password })

try {
  for (let i = 1; i <= 5; i++) {
    const run = {
      id:              randomUUID(),
      repo_id:         'test-repo',
      pr_number:       i,
      sha:             `abc000${i}`,
      predicted_skip:  ['test/auth.test.ts'],
      actual_failures: [],
      all_tests:       ['test/auth.test.ts', 'test/user.test.ts'],
      mode:            'shadow',
      time_saved_minutes: 0.5,
      created_at:      new Date().toISOString().replace('T', ' ').replace('Z', ''),
    }

    await client.insert({
      table: 'runs',
      values: [run],
      format: 'JSONEachRow',
    })
    console.log(`[seed-run] inserted run ${i}/5 id=${run.id} pr=${run.pr_number} sha=${run.sha}`)
  }
  console.log('[seed-run] inserted 5 runs for repo_id=test-repo')
} catch (err) {
  console.error('[seed-run] error:', err)
  process.exit(1)
} finally {
  await client.close()
}
