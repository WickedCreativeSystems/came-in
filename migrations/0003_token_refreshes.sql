-- Token refreshes go to auth.buffer.com, outside the API's rate pool (plan 1.2).
-- They are counted on their own so any effect on the pool shows up against
-- the ratelimit headers.
ALTER TABLE buffer_calls_daily ADD COLUMN token_refreshes INTEGER NOT NULL DEFAULT 0;
