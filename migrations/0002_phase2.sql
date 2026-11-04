-- Phase 2: the printed card's checklist chip, and the sample bakery's own
-- Setup and Ring my phone, kept per browser session like its taps (plan 1.5, 3.10).
ALTER TABLE shops ADD COLUMN card_printed_at TEXT;
CREATE TABLE sample_settings (
  session_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, key)
);
CREATE TABLE sample_push_subs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  failed_at TEXT
);
CREATE INDEX sample_push_session ON sample_push_subs(session_id);
CREATE INDEX counters_shop ON counters(shop_id);
CREATE UNIQUE INDEX push_subs_endpoint ON push_subs(endpoint);
