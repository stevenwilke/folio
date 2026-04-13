CREATE TABLE book_quotes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id     uuid        NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  quote_text  text        NOT NULL,
  page_number integer,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_book_quotes_user ON book_quotes (user_id, created_at DESC);
CREATE INDEX idx_book_quotes_book ON book_quotes (book_id, created_at DESC);

ALTER TABLE book_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read quotes"
  ON book_quotes FOR SELECT USING (true);
CREATE POLICY "Users insert own quotes"
  ON book_quotes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own quotes"
  ON book_quotes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own quotes"
  ON book_quotes FOR DELETE USING (auth.uid() = user_id);
