-- Came In never tags a Buffer post (Buffer refuses it on sent posts; plan 1.2 "No tags").
-- Tag jobs that were still waiting are closed. The old tag columns stay, unused.
UPDATE buffer_jobs SET done_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), error = 'tags dropped' WHERE kind = 'tag' AND done_at IS NULL;
