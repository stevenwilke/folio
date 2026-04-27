-- Combined migration for: reading streaks (cross-user), marketplace alerts,
-- and author Q&A. All functions use language sql with single-statement bodies
-- so they parse cleanly in Supabase Studio's SQL editor.

-- ============================================================================
-- 1. READING STREAKS — public-readable streak summary for any user.
-- reading_sessions is RLS-locked, so a SECURITY DEFINER aggregator is needed
-- to display streaks on others' profiles. Returns counts only — no leakage of
-- which books or what times.
-- ============================================================================

DROP FUNCTION IF EXISTS get_reading_streak_dates(uuid);

CREATE FUNCTION get_reading_streak_dates(p_user_id uuid)
RETURNS TABLE (active_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $body$
  -- Days where the user completed a session OR added a book to their library.
  -- We return the raw date set; client computes current/longest streak.
  SELECT DISTINCT d
  FROM (
    SELECT (ended_at AT TIME ZONE 'UTC')::date AS d
    FROM reading_sessions
    WHERE user_id = p_user_id
      AND status = 'completed'
      AND pages_read > 0
      AND ended_at IS NOT NULL
    UNION ALL
    SELECT (added_at AT TIME ZONE 'UTC')::date AS d
    FROM collection_entries
    WHERE user_id = p_user_id
      AND read_status IN ('read', 'reading')
  ) src
  WHERE d >= (current_date - interval '400 days')::date
$body$;

GRANT EXECUTE ON FUNCTION get_reading_streak_dates(uuid) TO authenticated, anon;


-- ============================================================================
-- 2. MARKETPLACE ALERTS — "notify me when this book is listed (under $X)".
-- ============================================================================

CREATE TABLE IF NOT EXISTS marketplace_alerts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id     uuid        NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  max_price   numeric,    -- NULL = any price
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_fired_at timestamptz,
  UNIQUE (user_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_alerts_book
  ON marketplace_alerts (book_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_marketplace_alerts_user
  ON marketplace_alerts (user_id);

ALTER TABLE marketplace_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own alerts"   ON marketplace_alerts;
DROP POLICY IF EXISTS "Users insert own alerts" ON marketplace_alerts;
DROP POLICY IF EXISTS "Users update own alerts" ON marketplace_alerts;
DROP POLICY IF EXISTS "Users delete own alerts" ON marketplace_alerts;

CREATE POLICY "Users see own alerts"
  ON marketplace_alerts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own alerts"
  ON marketplace_alerts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own alerts"
  ON marketplace_alerts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own alerts"
  ON marketplace_alerts FOR DELETE USING (auth.uid() = user_id);


-- Add 'marketplace_alert' notification type.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'friend_request', 'friend_accepted',
  'borrow_request', 'borrow_approved', 'borrow_returned',
  'order_update', 'recommendation', 'club_activity',
  'achievement', 'quote_shared', 'book_drop_claimed',
  'stale_reading',
  'author_claim',
  'author_post',
  'marketplace_alert',
  'author_question'
));

ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_type_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_type_check CHECK (type IN (
  'friend_request', 'friend_accepted',
  'borrow_request', 'borrow_approved', 'borrow_returned',
  'order_update',
  'recommendation',
  'club_activity',
  'achievement',
  'quote_shared',
  'book_drop_claimed',
  'stale_reading',
  'author_claim',
  'author_post',
  'marketplace_alert',
  'author_question'
));


-- ============================================================================
-- 3. AUTHOR Q&A — readers ask, verified author answers from the dashboard.
-- ============================================================================

CREATE TABLE IF NOT EXISTS author_questions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id   uuid        NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  asker_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question    text        NOT NULL,
  answer      text,
  answered_at timestamptz,
  is_public   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_author_questions_author
  ON author_questions (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_author_questions_asker
  ON author_questions (asker_id, created_at DESC);

ALTER TABLE author_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public sees answered questions"     ON author_questions;
DROP POLICY IF EXISTS "Asker sees own questions"           ON author_questions;
DROP POLICY IF EXISTS "Verified author sees all questions" ON author_questions;
DROP POLICY IF EXISTS "Anyone can ask"                     ON author_questions;
DROP POLICY IF EXISTS "Author answers own"                 ON author_questions;
DROP POLICY IF EXISTS "Asker can delete own"               ON author_questions;

-- Anyone can read questions that have been answered AND are public.
CREATE POLICY "Public sees answered questions"
  ON author_questions FOR SELECT
  USING (answer IS NOT NULL AND is_public = true);

-- The asker can always see their own questions (whether answered or not).
CREATE POLICY "Asker sees own questions"
  ON author_questions FOR SELECT
  USING (auth.uid() = asker_id);

-- The verified author can see all questions for their author profile.
CREATE POLICY "Verified author sees all questions"
  ON author_questions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM authors a
    WHERE a.id = author_id AND a.claimed_by = auth.uid() AND a.is_verified = true
  ));

-- Authenticated users can ask.
CREATE POLICY "Anyone can ask"
  ON author_questions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = asker_id);

-- Author can update (to add answer).
CREATE POLICY "Author answers own"
  ON author_questions FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM authors a
    WHERE a.id = author_id AND a.claimed_by = auth.uid() AND a.is_verified = true
  ));

-- Asker can delete their own unanswered question.
CREATE POLICY "Asker can delete own"
  ON author_questions FOR DELETE TO authenticated
  USING (auth.uid() = asker_id AND answer IS NULL);


NOTIFY pgrst, 'reload schema';
