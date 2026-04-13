-- Add post_type to distinguish quote shares from regular posts
ALTER TABLE reading_posts ADD COLUMN IF NOT EXISTS post_type text NOT NULL DEFAULT 'post'
  CHECK (post_type IN ('post', 'quote', 'activity'));

ALTER TABLE reading_posts ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES book_quotes(id) ON DELETE SET NULL;
