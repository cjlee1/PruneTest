export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { lookupToken } from '../../../lib/token'
import { getSavingsTrend } from '../../../lib/queries'
import { handleSavingsGet } from '../../../lib/handlers/savings'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const result = await handleSavingsGet(token, lookupToken, getSavingsTrend)
  return NextResponse.json(result.body, { status: result.status })
}
