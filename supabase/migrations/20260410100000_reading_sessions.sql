-- Reading sessions: tracks timed reading sessions for speed calibration
CREATE TABLE reading_sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id     uuid        NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  start_page  integer,
  end_page    integer,
  pages_read  integer,
  is_fiction   boolean,
  status      text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'completed', 'discarded')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Only one active session per user at a time
CREATE UNIQUE INDEX reading_sessions_one_active_per_user
  ON reading_sessions (user_id) WHERE status = 'active';

-- Fast lookup for speed computation
CREATE INDEX reading_sessions_user_completed
  ON reading_sessions (user_id, is_fiction) WHERE status = 'completed' AND pages_read > 0;

-- Book history
CREATE INDEX reading_sessions_book
  ON reading_sessions (book_id, user_id);

-- RLS
ALTER TABLE reading_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own sessions"
  ON reading_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sessions"
  ON reading_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions"
  ON reading_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sessions"
  ON reading_sessions FOR DELETE
  USING (auth.uid() = user_id);
