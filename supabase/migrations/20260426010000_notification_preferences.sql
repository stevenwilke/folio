-- Per-user, per-notification-type channel preferences.
-- Missing rows are treated as "all on" by the notify() helper.

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text        NOT NULL,
  email       boolean     NOT NULL DEFAULT true,
  push        boolean     NOT NULL DEFAULT true,
  in_app      boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type)
);

-- (Re)apply the CHECK constraint so it includes every current notification type.
-- Done as DROP + ADD so re-runs over an older shape upgrade in place.
ALTER TABLE notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_type_check;
ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_type_check CHECK (type IN (
    'friend_request', 'friend_accepted',
    'borrow_request', 'borrow_approved', 'borrow_returned',
    'order_update',
    'recommendation',
    'club_activity',
    'achievement',
    'quote_shared',
    'book_drop_claimed',
    'stale_reading',
    'author_claim'
  ));

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own prefs"    ON notification_preferences;
DROP POLICY IF EXISTS "Users insert own prefs" ON notification_preferences;
DROP POLICY IF EXISTS "Users update own prefs" ON notification_preferences;
DROP POLICY IF EXISTS "Users delete own prefs" ON notification_preferences;

CREATE POLICY "Users see own prefs"
  ON notification_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own prefs"
  ON notification_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own prefs"
  ON notification_preferences FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own prefs"
  ON notification_preferences FOR DELETE USING (auth.uid() = user_id);
