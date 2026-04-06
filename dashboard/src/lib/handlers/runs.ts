import type { RunRecord } from '../../../../shared/types'
import { hashToken } from '../token'
import { lookupToken } from '../token'
import { checkRunExists, insertRun } from '../runs'
import type { AlerterDep } from '../alerts'

const VALID_MODES = new Set(['shadow', 'conservative', 'standard', 'aggressive'])

function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((v) => typeof v === 'string')
}

export function isValidRunRecord(body: unknown): body is RunRecord {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>

  if (typeof b.id !== 'string' || b.id.trim() === '') return false
  if (typeof b.repo_id !== 'string' || b.repo_id.trim() === '') return false
  if (typeof b.sha !== 'string' || b.sha.trim() === '') return false
  if (!Number.isInteger(b.pr_number)) return false
  if (!isStringArray(b.predicted_skip)) return false
  if (!isStringArray(b.actual_failures)) return false
  if (!isStringArray(b.all_tests)) return false
  if (typeof b.mode !== 'string' || !VALID_MODES.has(b.mode)) return false
  if (b.created_at === undefined || b.created_at === null) return false
  if (!(b.created_at instanceof Date) && typeof b.created_at !== 'string') return false

  return true
}

export async function handleRunsPost(
  body: unknown,
  authHeader: string | null,
  tokenLookup: typeof lookupToken,
  runChecker: typeof checkRunExists,
  runInserter: typeof insertRun,
  alerter?: AlerterDep,
): Promise<{ status: number; body: unknown }> {
  // 1. Check Authorization header presence
  if (!authHeader) {
    return { status: 401, body: { status: 'error', message: 'Missing Authorization header' } }
  }

  // 2. Check Bearer prefix
  if (!authHeader.startsWith('Bearer ')) {
    return { status: 401, body: { status: 'error', message: 'Invalid Authorization header format' } }
  }

  // 3. Hash the raw token
  const rawToken = authHeader.slice('Bearer '.length)
  const hash = hashToken(rawToken)

  // 4. Lookup the token
  const tokenRow = await tokenLookup(hash)
  if (!tokenRow) {
    return { status: 401, body: { status: 'error', message: 'Invalid token' } }
  }

  // 5. Check active flag
  if (!tokenRow.active) {
    return { status: 401, body: { status: 'error', message: 'Token is inactive' } }
  }

  // 6. Validate body shape
  if (!isValidRunRecord(body)) {
    return { status: 400, body: { status: 'error', message: 'Invalid request body' } }
  }

  // 7. repo_id binding — token must match the body's repo_id
  if (body.repo_id !== tokenRow.repoId) {
    return { status: 403, body: { status: 'error', message: 'Token not authorized for this repo' } }
  }

  // 8. Dedup check
  const exists = await runChecker(body.id, body.repo_id)
  if (exists) {
    return { status: 200, body: { status: 'duplicate' } }
  }

  // 9. Derive time_saved_minutes
  const timeSavedMinutes = body.predicted_skip.length * 0.5

  // 10. Parse created_at to ClickHouse DateTime format ('YYYY-MM-DD HH:MM:SS')
  const createdAt = new Date(body.created_at as unknown as string).toISOString().replace('T', ' ').replace('Z', '')

  // 11. Insert and return 201
  try {
    await runInserter({
      id: body.id,
      repo_id: body.repo_id,
      pr_number: body.pr_number,
      sha: body.sha,
      predicted_skip: body.predicted_skip,
      actual_failures: body.actual_failures,
      all_tests: body.all_tests,
      mode: body.mode,
      time_saved_minutes: timeSavedMinutes,
      created_at: createdAt,
    })
  } catch {
    return { status: 500, body: { status: 'error' } }
  }

  // 12. Fire alerts (optional, fail-open)
  if (alerter) {
    await alerter(body.repo_id).catch(err => console.error('[alerts] alerter error:', err))
  }

  return { status: 201, body: { status: 'created' } }
}
