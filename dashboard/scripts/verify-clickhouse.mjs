#!/usr/bin/env node
// One-off dev script: verify a synthetic RunRecord exists in ClickHouse via SELECT FINAL.
// Usage: node dashboard/scripts/verify-clickhouse.mjs
// Env: CLICKHOUSE_URL, CLICKHOUSE_USERNAME, CLICKHOUSE_PASSWORD

import { createClient } from '@clickhouse/client-web'

const url      = process.env.CLICKHOUSE_URL      ?? 'http://localhost:8123'
const username = process.env.CLICKHOUSE_USERNAME ?? 'default'
const password = process.env.CLICKHOUSE_PASSWORD ?? ''

const client = createClient({ url, username, password })

try {
  const result = await client.query({
    query: `SELECT * FROM runs FINAL WHERE repo_id = 'test-repo' ORDER BY created_at DESC LIMIT 10`,
    format: 'JSONEachRow',
  })
  const rows = await result.json()
  if (rows.length === 0) {
    console.error('[verify-ch] FAIL: no rows found for repo_id=test-repo')
    process.exit(1)
  }
  console.log(`[verify-ch] PASS: found ${rows.length} row(s) for repo_id=test-repo`)
  console.log('[verify-ch] latest row:', JSON.stringify(rows[0], null, 2))
} catch (err) {
  console.error('[verify-ch] error:', err)
  process.exit(1)
} finally {
  await client.close()
}
