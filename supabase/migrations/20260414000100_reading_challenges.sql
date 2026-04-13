CREATE TABLE reading_challenges (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title          text        NOT NULL,
  description    text,
  challenge_type text        NOT NULL CHECK (challenge_type IN ('books_count', 'pages_count', 'genre_diversity', 'streak_days')),
  target_value   integer     NOT NULL,
  current_value  integer     NOT NULL DEFAULT 0,
  month          integer,
  year           integer     NOT NULL,
  status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  is_system      boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);

CREATE INDEX idx_reading_challenges_user_year   ON reading_challenges (user_id, year);
CREATE INDEX idx_reading_challenges_user_active ON reading_challenges (user_id) WHERE status = 'active';

ALTER TABLE reading_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own challenges"
  ON reading_challenges FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own challenges"
  ON reading_challenges FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own challenges"
  ON reading_challenges FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own challenges"
  ON reading_challenges FOR DELETE USING (auth.uid() = user_id);
