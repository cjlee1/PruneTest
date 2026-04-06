/**
 * provisioning.ts — Open-source token provisioning.
 *
 * Tokens are provisioned via admin seed scripts (see dashboard/scripts/).
 * This module exposes the `provisionToken` helper for programmatic use.
 *
 * EmailSenderDep has moved to lib/email.ts.
 * Re-exported here for backwards-compat with any existing imports.
 */

export type { EmailSenderDep } from './email'

import { db } from './db/index'
import { apiTokens } from './db/schema'
import { hashToken } from './token'
import type { NewApiToken } from './db/schema'

export type TokenInserterDep = (
  values: NewApiToken,
) => Promise<{ tokenHash: string }[]>

export type ProvisionParams = {
  repoId: string
  plan?: 'free' | 'pro' | 'team'
}

export type ProvisionResult = {
  inserted: boolean
  rawToken?: string
  tokenHash?: string
}

/**
 * Provisions a new API token for a repo.
 *
 * Returns the raw token (shown once — caller must surface it to the user)
 * and the stored hash. Idempotency is the caller's responsibility when
 * using the admin scripts.
 */
export async function provisionToken(
  params: ProvisionParams,
  inserter?: TokenInserterDep,
): Promise<ProvisionResult> {
  const { repoId, plan = 'free' } = params

  const rawToken = crypto.randomUUID()
  const tokenHash = hashToken(rawToken)

  const insert =
    inserter ??
    ((values: NewApiToken) =>
      db
        .insert(apiTokens)
        .values(values)
        .returning({ tokenHash: apiTokens.tokenHash }))

  const inserted = await insert({ tokenHash, repoId, plan, active: true })

  if (inserted.length === 0) {
    return { inserted: false }
  }

  return { inserted: true, rawToken, tokenHash }
}
