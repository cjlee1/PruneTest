#!/usr/bin/env node
// ESM migration script — no transpilation needed.
// Usage: node dashboard/scripts/clickhouse-migrate.mjs
// Env: CLICKHOUSE_URL, CLICKHOUSE_USERNAME, CLICKHOUSE_PASSWORD

import { createClient } from '@clickhouse/client-web'

const url = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123'
const username = process.env.CLICKHOUSE_USERNAME ?? 'default'
const password = process.env.CLICKHOUSE_PASSWORD ?? ''

const client = createClient({ url, username, password })

const DDL = `
CREATE TABLE IF NOT EXISTS runs
(
    id                 String,
    repo_id            String,
    pr_number          UInt32,
    sha                String,
    predicted_skip     Array(String),
    actual_failures    Array(String),
    all_tests          Array(String),
    mode               LowCardinality(String),
    time_saved_minutes Float32,
    created_at         DateTime64(3)
)
ENGINE = ReplacingMergeTree
PARTITION BY (repo_id, toYYYYMM(created_at))
ORDER BY (repo_id, created_at, id)
`

try {
  await client.command({ query: DDL })
  console.log('[migrate] runs table created (or already exists)')
} catch (err) {
  console.error('[migrate] failed to create runs table:', err)
  process.exit(1)
} finally {
  await client.close()
}
