import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core'

export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  repoId: text('repo_id').notNull(),
  plan: text('plan').notNull().default('free'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
})

export type ApiToken = typeof apiTokens.$inferSelect
export type NewApiToken = typeof apiTokens.$inferInsert

export const alertState = pgTable('alert_state', {
  repoId: text('repo_id').primaryKey(),
  alertFiredAt: timestamp('alert_fired_at'),
  recoveredAt: timestamp('recovered_at'),
  alertEmail: text('alert_email'),
  slackWebhookUrl: text('slack_webhook_url'),
})
export type AlertState = typeof alertState.$inferSelect
export type NewAlertState = typeof alertState.$inferInsert
