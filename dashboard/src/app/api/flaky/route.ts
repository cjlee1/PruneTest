export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { lookupToken } from '../../../lib/token'
import { getFlakyLeaderboard } from '../../../lib/queries'
import { handleFlakyGet } from '../../../lib/handlers/flaky'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const result = await handleFlakyGet(token, lookupToken, getFlakyLeaderboard)
  return NextResponse.json(result.body, { status: result.status })
}
