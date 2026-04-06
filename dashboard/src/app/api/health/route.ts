import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { pingClickHouse } from '@/lib/clickhouse'

export const runtime = 'nodejs'

export async function GET() {
  const [pgStatus, chStatus] = await Promise.all([
    db.execute(sql`SELECT 1`)
      .then(() => 'ok' as const)
      .catch((err: unknown) => {
        console.error('[health] postgres check failed:', err)
        return 'error' as const
      }),
    pingClickHouse()
      .then((ok) => (ok ? 'ok' : 'error') as 'ok' | 'error')
      .catch((err: unknown) => {
        console.error('[health] clickhouse check failed:', err)
        return 'error' as const
      }),
  ])

  return NextResponse.json({ pg: pgStatus, ch: chStatus })
}
