export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { lookupToken } from '../../../lib/token'
import { checkRunExists, insertRun } from '../../../lib/runs'
import { checkAndFireAlerts, getAlertState, upsertAlertState } from '../../../lib/alerts'
import { getRecentRecall } from '../../../lib/queries'
import { makeConsoleFallbackEmailSender } from '../../../lib/email'
import type { AlerterDep } from '../../../lib/alerts'
import { handleRunsPost } from '../../../lib/handlers/runs'

const realAlerter: AlerterDep = (repoId) =>
  checkAndFireAlerts(repoId, {
    getRecall: getRecentRecall,
    getState: getAlertState,
    upsertState: upsertAlertState,
    emailSender: makeConsoleFallbackEmailSender(),
    slackPost: async (url, text) => {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
    },
  })

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ status: 'error', message: 'Invalid JSON' }, { status: 400 })
  }

  const authHeader = req.headers.get('authorization')
  const result = await handleRunsPost(
    body,
    authHeader,
    lookupToken,
    checkRunExists,
    insertRun,
    realAlerter,
  )
  return NextResponse.json(result.body, { status: result.status })
}
