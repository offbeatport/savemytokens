import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/* ── better-auth core tables ─────────────────────────────────── */

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

/* ── App tables ──────────────────────────────────────────────── */

/** A single one-time scan. Holds the computed snapshot + full report JSON. */
export const scan = sqliteTable('scan', {
  id: text('id').primaryKey(),
  userId: text('user_id'), // nullable - scans can be anonymous before purchase
  source: text('source').notNull(), // 'upload' | 'openai' | 'anthropic' | 'gemini' | 'sample'
  scenario: text('scenario').notNull(), // mock scenario key driving the data
  spendAnalyzed: integer('spend_analyzed').notNull().default(0),
  healthScore: integer('health_score').notNull().default(0),
  snapshotJson: text('snapshot_json').notNull(), // legacy ai-cost-health mirror (free-preview)
  reportJson: text('report_json').notNull(), // legacy ai-cost-health mirror (full)
  unlocked: integer('unlocked', { mode: 'boolean' }).notNull().default(false), // legacy ai-cost-health mirror
  checkoutId: text('checkout_id'),
  email: text('email'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  // multi-report columns
  rowsJson: text('rows_json'), // parsed UsageRow[] (metadata only) - enables re-run/backfill
  reportsJson: text('reports_json'), // Record<ReportSlug,{snapshot,report}> - source of truth
  revenueMapJson: text('revenue_map_json'), // optional RevenueMap for ai-margin-leak
  costBasis: text('cost_basis'), // 'actual' | 'estimated' | 'mixed'
  engineVersion: integer('engine_version').notNull().default(1),
})

/** "Notify me" signups for coming-soon reports. */
export const notifySignup = sqliteTable('notify_signup', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  reportSlug: text('report_slug').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

/** Per-report unlocks. report_slug = a ReportSlug OR 'bundle' (= all). */
export const scanUnlock = sqliteTable('scan_unlock', {
  id: text('id').primaryKey(),
  scanId: text('scan_id').notNull(),
  reportSlug: text('report_slug').notNull(),
  checkoutId: text('checkout_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

/** Free-form "I want X" requests from the feedback modal. */
export const featureRequest = sqliteTable('feature_request', {
  id: text('id').primaryKey(),
  message: text('message').notNull(),
  email: text('email'),
  path: text('path'), // page the request came from
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

export type ScanRow = typeof scan.$inferSelect
export type NotifyRow = typeof notifySignup.$inferSelect
export type ScanUnlockRow = typeof scanUnlock.$inferSelect
export type FeatureRequestRow = typeof featureRequest.$inferSelect
