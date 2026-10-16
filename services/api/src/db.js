import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

export function openDb(path = config.dbPath) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, county TEXT NOT NULL, delivery_days INTEGER NOT NULL DEFAULT 2
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, name_en TEXT NOT NULL, name_sw TEXT NOT NULL, category TEXT NOT NULL,
      unit TEXT NOT NULL, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      price_kes INTEGER NOT NULL, stock INTEGER NOT NULL, keywords TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,                 -- client generated UUID: also the idempotency key
      client_id TEXT NOT NULL,             -- pseudonymous device/user id
      status TEXT NOT NULL,                -- approved | needs_reapproval | payment_pending | paid | failed | cancelled
      lang TEXT NOT NULL,
      items_json TEXT NOT NULL,
      total_kes INTEGER NOT NULL,
      approved_total_kes INTEGER NOT NULL,
      budget_kes INTEGER NOT NULL,
      approval_method TEXT NOT NULL,       -- touch | voice | gesture | switch | agent
      approved_at TEXT NOT NULL,
      created_offline INTEGER NOT NULL DEFAULT 0,
      agent_id TEXT,
      inclusion_consent INTEGER NOT NULL DEFAULT 0,
      usd_amount TEXT, fx_rate REAL,
      payment_mode TEXT,                   -- paypal_sandbox | simulated
      paypal_order_id TEXT, paypal_capture_id TEXT,
      receipt_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, type TEXT NOT NULL, detail TEXT, at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, payout_email TEXT, trained INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS programs (
      id TEXT PRIMARY KEY, sponsor TEXT NOT NULL, name TEXT NOT NULL, goal TEXT NOT NULL,
      reward_kes INTEGER NOT NULL, funded_kes INTEGER NOT NULL DEFAULT 0, funding_mode TEXT NOT NULL DEFAULT 'simulated',
      target_outcomes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY, program_id TEXT NOT NULL REFERENCES programs(id), agent_id TEXT NOT NULL REFERENCES agents(id),
      order_id TEXT NOT NULL UNIQUE, beneficiary_ref TEXT NOT NULL, type TEXT NOT NULL,
      reward_kes INTEGER NOT NULL, status TEXT NOT NULL,  -- eligible | paid | rejected
      evidence TEXT NOT NULL, payout_mode TEXT, payout_ref TEXT, created_at TEXT NOT NULL, paid_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_milestone_beneficiary ON milestones(program_id, beneficiary_ref);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}

export const now = () => new Date().toISOString();

export function logEvent(db, orderId, type, detail = '') {
  db.prepare('INSERT INTO order_events (order_id, type, detail, at) VALUES (?,?,?,?)').run(orderId, type, String(detail), now());
}

export function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
}
