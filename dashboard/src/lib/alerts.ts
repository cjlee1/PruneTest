/**
 * alerts.ts — Alert state data-access helpers and alert orchestration.
 *
 * Provides Drizzle-backed read/write helpers for the alert_state table,
 * plus checkAndFireAlerts() which implements the full alert state machine.
 * All functions fail open and log on error.
 */

import { eq } from 'drizzle-orm'
import { db } from './db/index'
import { alertState } from './db/schema'
import type { EmailSenderDep } from './email'
import type { getRecentRecall } from './queries'

// Re-export types for consumers
export type { AlertState, NewAlertState } from './db/schema'

// ─── Dependency types ────────────────────────────────────────────────────────

/** Injectable alerter — called by POST /api/runs after successful insert. */
export type AlerterDep = (repoId: string) => Promise<void>

// ─── Data-access helpers ─────────────────────────────────────────────────────

/**
 * Returns the current alert state for a repo, or null if not found or on error.
 */
export async function getAlertState(repoId: string): Promise<import('./db/schema').AlertState | null> {
  try {
    const rows = await db
      .select()
      .from(alertState)
      .where(eq(alertState.repoId, repoId))
      .limit(1)
    return rows[0] ?? null
  } catch (err) {
    console.error('[alerts] getAlertState error:', err)
    return null
  }
}

/**
 * Upserts alert state for a repo. On conflict with existing repoId, updates
 * all non-PK columns. Fails open — logs and swallows errors.
 */
export async function upsertAlertState(state: import('./db/schema').NewAlertState): Promise<void> {
  try {
    await db
      .insert(alertState)
      .values(state)
      .onConflictDoUpdate({
        target: alertState.repoId,
        set: {
          alertFiredAt: state.alertFiredAt,
          recoveredAt: state.recoveredAt,
          alertEmail: state.alertEmail,
          slackWebhookUrl: state.slackWebhookUrl,
        },
      })
  } catch (err) {
    console.error('[alerts] upsertAlertState error:', err)
  }
}

// ─── Alert state machine ─────────────────────────────────────────────────────

const ALERT_THRESHOLD = 0.95
const RECOVERY_THRESHOLD = 0.98

const FROM_ADDRESS = 'alerts@testselector.dev'

/**
 * Checks current recall for a repo and fires/deduplicates alerts as needed.
 *
 * State machine:
 *  - recall < 0.95 AND no active alert → fire degradation alert, record alertFiredAt
 *  - recall < 0.95 AND alertFiredAt set AND recoveredAt null → dedup, skip
 *  - recall ≥ 0.98 AND alertFiredAt set AND recoveredAt null → fire recovery alert, record recoveredAt
 *  - recall ≥ 0.98 AND no active alert (or already recovered) → nothing to do
 *
 * Entire function is try/catch fail-open: any unhandled error → log, never throws.
 */
export async function checkAndFireAlerts(
  repoId: string,
  deps: {
    getRecall: typeof getRecentRecall
    getState: typeof getAlertState
    upsertState: typeof upsertAlertState
    emailSender: EmailSenderDep
    slackPost?: (url: string, text: string) => Promise<void>
  },
): Promise<void> {
  try {
    const { getRecall, getState, upsertState, emailSender, slackPost } = deps

    // 1. Fetch current recall
    const { recall } = await getRecall(repoId)
    // 2. Fetch current alert state (null if never set)
    const state = await getState(repoId)

    const alertFiredAt = state?.alertFiredAt ?? null
    const recoveredAt = state?.recoveredAt ?? null
    const alertEmail = state?.alertEmail ?? null
    const slackWebhookUrl = state?.slackWebhookUrl ?? null

    if (recall >= ALERT_THRESHOLD) {
      // Recall is acceptable — check if we need to send a recovery notification
      // Recovery requires ≥ RECOVERY_THRESHOLD (0.98) hysteresis band
      const needsRecovery =
        recall >= RECOVERY_THRESHOLD && alertFiredAt !== null && recoveredAt === null

      if (needsRecovery) {
        // Send recovery email
        console.log(`[alerts] recovery detected: recall=${recall} for ${repoId}`)

        if (alertEmail) {
          const emailResult = await emailSender({
            from: FROM_ADDRESS,
            to: alertEmail,
            subject: `TestSelector: Accuracy recovered for ${repoId}`,
            html: `<p>Accuracy for <strong>${repoId}</strong> has recovered to ${(recall * 100).toFixed(1)}%.</p>`,
          })
          if (emailResult.error) {
            console.error('[alerts] email error:', emailResult.error)
          }
        }

        // Update state: mark recovered
        await upsertState({
          repoId,
          alertFiredAt,
          recoveredAt: new Date(),
          alertEmail,
          slackWebhookUrl,
        })

        // Slack recovery notification
        if (slackPost && slackWebhookUrl) {
          try {
            await slackPost(
              slackWebhookUrl,
              `✅ TestSelector: Accuracy recovered for ${repoId} (recall: ${(recall * 100).toFixed(1)}%)`,
            )
          } catch (slackErr) {
            console.error('[alerts] Slack webhook error:', slackErr)
          }
        }
      }
      // else: recall ≥ threshold, no active alert — nothing to do
    } else {
      // recall < ALERT_THRESHOLD
      console.log(`[alerts] recall below threshold: recall=${recall} for ${repoId}`)

      const activeAlert = alertFiredAt !== null && recoveredAt === null

      if (activeAlert) {
        // Already alerted and not yet recovered — dedup, skip
        console.log(`[alerts] alert already fired: repoId=${repoId}, alertFiredAt=${alertFiredAt?.toISOString()}`)
        return
      }

      // New degradation alert (either first time, or after a recovery cycle)
      if (alertEmail) {
        const emailResult = await emailSender({
          from: FROM_ADDRESS,
          to: alertEmail,
          subject: `TestSelector: Accuracy alert for ${repoId}`,
          html: `<p>Accuracy for <strong>${repoId}</strong> has dropped to ${(recall * 100).toFixed(1)}%.</p>`,
        })
        if (emailResult.error) {
          console.error('[alerts] email error:', emailResult.error)
        }
      }

      // Record alert fired (preserve existing alertEmail/slackWebhookUrl from state if present)
      await upsertState({
        repoId,
        alertFiredAt: new Date(),
        recoveredAt: null,
        alertEmail,
        slackWebhookUrl,
      })

      // Slack degradation notification
      if (slackPost && slackWebhookUrl) {
        try {
          await slackPost(
            slackWebhookUrl,
            `🚨 TestSelector: Accuracy alert for ${repoId} (recall: ${(recall * 100).toFixed(1)}%)`,
          )
        } catch (slackErr) {
          console.error('[alerts] Slack webhook error:', slackErr)
        }
      }
    }
  } catch (err) {
    console.error('[alerts] checkAndFireAlerts error:', err)
  }
}
