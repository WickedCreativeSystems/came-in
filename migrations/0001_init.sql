-- Came In: the data, from the plan's section 1.3.
CREATE TABLE shops (
  id TEXT PRIMARY KEY,
  buffer_account_id TEXT NOT NULL,
  buffer_org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  handle TEXT NOT NULL DEFAULT '',
  avatar_key TEXT,
  card_channel_id TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  thank_you_text TEXT,
  review_url TEXT,
  mark_winners INTEGER NOT NULL DEFAULT 1,
  theme TEXT NOT NULL DEFAULT 'system',
  awake_until TEXT,
  last_polled_at TEXT,
  polls_quiet INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  deleted_at TEXT,
  UNIQUE (buffer_account_id, buffer_org_id)
);
CREATE TABLE buffer_tokens (
  shop_id TEXT PRIMARY KEY REFERENCES shops(id),
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT ''
);
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  display_name TEXT,
  service TEXT NOT NULL,
  avatar TEXT,
  external_link TEXT,
  timezone TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX channels_shop ON channels(shop_id);
CREATE TABLE tiles (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  nickname TEXT,
  subject TEXT,
  text_hash TEXT NOT NULL,
  first_sent_at TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  tagged_at TEXT,
  note_id TEXT,
  note_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX tiles_shop_hash ON tiles(shop_id, text_hash);
CREATE INDEX tiles_shop_sent ON tiles(shop_id, first_sent_at);
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  tile_id TEXT NOT NULL REFERENCES tiles(id),
  channel_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL,
  external_link TEXT,
  is_story INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'text',
  kind_detail TEXT,
  thumb_key TEXT,
  thumb_status TEXT NOT NULL DEFAULT 'pending',
  source_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX posts_shop_sent ON posts(shop_id, sent_at);
CREATE INDEX posts_tile ON posts(tile_id);
CREATE TABLE taps (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  tile_id TEXT,
  answer TEXT NOT NULL,
  source TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  rewarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX taps_shop_created ON taps(shop_id, created_at);
CREATE INDEX taps_shop_device ON taps(shop_id, device_hash, created_at);
CREATE TABLE counters (
  token TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE TABLE push_subs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  device_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  ua TEXT,
  created_at TEXT NOT NULL,
  failed_at TEXT
);
CREATE INDEX push_subs_shop ON push_subs(shop_id);
CREATE TABLE buffer_rate (
  window TEXT PRIMARY KEY,
  remaining INTEGER,
  quota INTEGER,
  reset_at TEXT,
  blocked_until TEXT
);
CREATE TABLE buffer_jobs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  next_at TEXT NOT NULL,
  done_at TEXT,
  error TEXT
);
CREATE INDEX buffer_jobs_due ON buffer_jobs(done_at, next_at);
CREATE TABLE buffer_calls_daily (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sample_taps (
  session_id TEXT NOT NULL,
  tile_id TEXT,
  answer TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sample_taps_session ON sample_taps(session_id);
CREATE INDEX sample_taps_created ON sample_taps(created_at);
