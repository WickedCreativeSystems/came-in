-- The original post's network type (post, reel, story...), reused by Post it again (plan 1.2).
ALTER TABLE posts ADD COLUMN meta_type TEXT;
