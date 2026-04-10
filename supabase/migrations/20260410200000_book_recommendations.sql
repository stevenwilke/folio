-- Book recommendations: targeted book suggestions between friends
CREATE TABLE book_recommendations (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id       uuid        NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  note          text,
  read          boolean     NOT NULL DEFAULT false,
  dismissed     boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sender_id, recipient_id, book_id)
);

ALTER TABLE book_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own recommendations"
  ON book_recommendations FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY "Users can send recommendations"
  ON book_recommendations FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Recipients can update recommendations"
  ON book_recommendations FOR UPDATE
  USING (auth.uid() = recipient_id);

CREATE INDEX book_recommendations_recipient_idx
  ON book_recommendations (recipient_id, read, dismissed);

CREATE INDEX book_recommendations_sender_idx
  ON book_recommendations (sender_id);
