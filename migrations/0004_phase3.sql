-- Phase 3: the "Came in" tag in Buffer (plan 1.2, P13) and the Monday push (P11).
-- tag_state: 'unknown' until we look, 'ok' with tag_id, 'off' when Buffer won't
-- make the tag (a free plan at its limit): tagging is then silently off.
ALTER TABLE shops ADD COLUMN tag_id TEXT;
ALTER TABLE shops ADD COLUMN tag_state TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE shops ADD COLUMN monday_push_week TEXT;
CREATE INDEX buffer_jobs_shop ON buffer_jobs(shop_id, done_at);
-- The sample's own taps keep where they came from, for its This week.
ALTER TABLE sample_taps ADD COLUMN source TEXT NOT NULL DEFAULT 'card';
