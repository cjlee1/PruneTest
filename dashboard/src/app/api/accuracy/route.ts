export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { lookupToken } from '../../../lib/token'
import { getAccuracyTrend } from '../../../lib/queries'
import { handleAccuracyGet } from '../../../lib/handlers/accuracy'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const result = await handleAccuracyGet(token, lookupToken, getAccuracyTrend)
  return NextResponse.json(result.body, { status: result.status })
}
