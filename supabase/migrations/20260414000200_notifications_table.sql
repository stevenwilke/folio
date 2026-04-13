CREATE TABLE notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text        NOT NULL CHECK (type IN (
    'friend_request', 'friend_accepted',
    'borrow_request', 'borrow_approved', 'borrow_returned',
    'order_update',
    'recommendation',
    'club_activity',
    'achievement',
    'quote_shared'
  )),
  title       text        NOT NULL,
  body        text,
  link        text,
  metadata    jsonb       DEFAULT '{}',
  is_read     boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, created_at DESC) WHERE NOT is_read;
CREATE INDEX idx_notifications_user_recent
  ON notifications (user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own notifications"
  ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Anyone can insert notifications"
  ON notifications FOR INSERT WITH CHECK (true);
