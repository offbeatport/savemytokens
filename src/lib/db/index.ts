import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as schema from './schema'
import { env } from '@/lib/env'

const dbPath = resolve(process.cwd(), env.SQLITE_PATH)
mkdirSync(dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

/**
 * Idempotent schema bootstrap so the app works with zero setup
 * (`pnpm install && pnpm dev`) - no separate migrate step required.
 */
function ensureSchema() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      ip_address TEXT,
      user_agent TEXT,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      access_token TEXT,
      refresh_token TEXT,
      id_token TEXT,
      access_token_expires_at INTEGER,
      refresh_token_expires_at INTEGER,
      scope TEXT,
      password TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS scan (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      source TEXT NOT NULL,
      scenario TEXT NOT NULL,
      spend_analyzed INTEGER NOT NULL DEFAULT 0,
      health_score INTEGER NOT NULL DEFAULT 0,
      snapshot_json TEXT NOT NULL,
      report_json TEXT NOT NULL,
      unlocked INTEGER NOT NULL DEFAULT 0,
      checkout_id TEXT,
      email TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS notify_signup (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      report_slug TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS feature_request (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      email TEXT,
      path TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_scan_checkout ON scan(checkout_id);
    CREATE INDEX IF NOT EXISTS idx_notify_email ON notify_signup(email);
  `)

  // Additive columns for the multi-report engine (SQLite has no ADD COLUMN IF NOT EXISTS).
  addColumn('scan', 'rows_json', 'TEXT')
  addColumn('scan', 'reports_json', 'TEXT')
  addColumn('scan', 'revenue_map_json', 'TEXT')
  addColumn('scan', 'cost_basis', 'TEXT')
  addColumn('scan', 'engine_version', 'INTEGER NOT NULL DEFAULT 1')

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS scan_unlock (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      report_slug TEXT NOT NULL,
      checkout_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_scan_unlock ON scan_unlock(scan_id, report_slug);
    CREATE INDEX IF NOT EXISTS idx_scan_unlock_checkout ON scan_unlock(checkout_id);
  `)

  // AI Margin Intelligence tables.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS margin_ingest (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      source TEXT NOT NULL,
      period TEXT NOT NULL,
      period_label TEXT NOT NULL,
      mode TEXT NOT NULL,
      has_revenue INTEGER NOT NULL DEFAULT 0,
      cost_basis TEXT,
      usage_json TEXT NOT NULL,
      revenue_json TEXT,
      result_json TEXT,
      email TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS margin_snapshot (
      id TEXT PRIMARY KEY,
      ingest_id TEXT NOT NULL,
      user_id TEXT,
      entity_kind TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_label TEXT NOT NULL,
      period TEXT NOT NULL,
      revenue INTEGER NOT NULL DEFAULT 0,
      cost INTEGER NOT NULL DEFAULT 0,
      margin_pct INTEGER,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS stripe_connection (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      access_token TEXT,
      account_id TEXT,
      connected_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_margin_snapshot_entity ON margin_snapshot(entity_kind, entity_id, period);
    CREATE INDEX IF NOT EXISTS idx_margin_snapshot_user ON margin_snapshot(user_id, period);
  `)
}

function addColumn(table: string, col: string, ddl: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === col)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`)
  }
}

ensureSchema()

export const db = drizzle(sqlite, { schema })
export { schema }
