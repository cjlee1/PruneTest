export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

/**
 * Stripe billing was removed when the project went open-source.
 * This endpoint is intentionally disabled. Self-hosted installs provision
 * tokens via the admin seed scripts in dashboard/scripts/.
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Stripe billing is not enabled in this open-source build.' },
    { status: 410 },
  )
}
