import { createClient } from '@clickhouse/client-web'

const url = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123'

export const chClient = createClient({
  url,
  username: process.env.CLICKHOUSE_USERNAME ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  clickhouse_settings: {
    wait_end_of_query: 1,
  },
})

/**
 * Pings ClickHouse by running SELECT 1.
 * Returns true if the connection succeeds, false on any error.
 */
export async function pingClickHouse(): Promise<boolean> {
  try {
    const result = await chClient.query({
      query: 'SELECT 1',
      format: 'JSONEachRow',
    })
    await result.json()
    return true
  } catch (err) {
    console.error('[clickhouse] ping failed:', err)
    return false
  }
}
