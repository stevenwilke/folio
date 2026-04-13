CREATE TABLE badge_unlocks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id    text        NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, badge_id)
);

CREATE INDEX idx_badge_unlocks_user ON badge_unlocks (user_id, unlocked_at DESC);

ALTER TABLE badge_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own unlocks"
  ON badge_unlocks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own unlocks"
  ON badge_unlocks FOR INSERT WITH CHECK (auth.uid() = user_id);
