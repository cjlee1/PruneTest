import { hashToken, lookupToken } from '../token'
import { getAccuracyTrend } from '../queries'

export async function handleAccuracyGet(
  token: string | null,
  tokenLookup: typeof lookupToken,
  queryFn: typeof getAccuracyTrend,
): Promise<{ status: number; body: unknown }> {
  if (!token) return { status: 401, body: { error: 'Missing token' } }
  const row = await tokenLookup(hashToken(token))
  if (!row || !row.active) return { status: 401, body: { error: 'Invalid token' } }
  const data = await queryFn(row.repoId)
  return { status: 200, body: data }
}
