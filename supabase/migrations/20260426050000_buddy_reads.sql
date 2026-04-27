-- Buddy reads: read a book together with friends, track each other's progress,
-- and chat on a shared thread.

CREATE TABLE IF NOT EXISTS buddy_reads (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id         uuid        NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  owner_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text,                 -- optional friendly name
  target_finish   date,                 -- optional shared deadline
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'completed', 'cancelled')),
  is_public       boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buddy_reads_book  ON buddy_reads (book_id);
CREATE INDEX IF NOT EXISTS idx_buddy_reads_owner ON buddy_reads (owner_id);


CREATE TABLE IF NOT EXISTS buddy_read_participants (
  buddy_read_id    uuid        NOT NULL REFERENCES buddy_reads(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status           text        NOT NULL DEFAULT 'invited'
                               CHECK (status IN ('invited', 'joined', 'declined', 'finished')),
  current_page     integer     NOT NULL DEFAULT 0,
  last_progress_at timestamptz,
  joined_at        timestamptz,
  invited_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buddy_read_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_buddy_read_participants_user
  ON buddy_read_participants (user_id, status);


CREATE TABLE IF NOT EXISTS buddy_read_messages (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  buddy_read_id uuid        NOT NULL REFERENCES buddy_reads(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body          text        NOT NULL,
  page_anchor   integer,                -- optional: tag the message with a page #
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buddy_read_messages_thread
  ON buddy_read_messages (buddy_read_id, created_at);


-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE buddy_reads             ENABLE ROW LEVEL SECURITY;
ALTER TABLE buddy_read_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE buddy_read_messages     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner or participant or public sees buddy_reads" ON buddy_reads;
DROP POLICY IF EXISTS "Authenticated can create buddy_reads"            ON buddy_reads;
DROP POLICY IF EXISTS "Owner can update buddy_reads"                    ON buddy_reads;
DROP POLICY IF EXISTS "Owner can delete buddy_reads"                    ON buddy_reads;

DROP POLICY IF EXISTS "Participants see participant rows"   ON buddy_read_participants;
DROP POLICY IF EXISTS "Owner manages participant rows"      ON buddy_read_participants;
DROP POLICY IF EXISTS "User updates own participant row"    ON buddy_read_participants;
DROP POLICY IF EXISTS "User can leave (delete own row)"     ON buddy_read_participants;

DROP POLICY IF EXISTS "Participants see messages"   ON buddy_read_messages;
DROP POLICY IF EXISTS "Participants insert messages" ON buddy_read_messages;
DROP POLICY IF EXISTS "User deletes own messages"   ON buddy_read_messages;

-- buddy_reads SELECT: owner, any joined/invited participant, OR public flag.
CREATE POLICY "Owner or participant or public sees buddy_reads"
  ON buddy_reads FOR SELECT
  USING (
    is_public = true
    OR owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM buddy_read_participants p
      WHERE p.buddy_read_id = id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated can create buddy_reads"
  ON buddy_reads FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owner can update buddy_reads"
  ON buddy_reads FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id);

CREATE POLICY "Owner can delete buddy_reads"
  ON buddy_reads FOR DELETE TO authenticated
  USING (auth.uid() = owner_id);

-- participants SELECT: anyone who can see the buddy_read.
CREATE POLICY "Participants see participant rows"
  ON buddy_read_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM buddy_reads br
      WHERE br.id = buddy_read_id
        AND (
          br.is_public = true
          OR br.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM buddy_read_participants p2
            WHERE p2.buddy_read_id = br.id AND p2.user_id = auth.uid()
          )
        )
    )
  );

-- Owner can invite/remove participants.
CREATE POLICY "Owner manages participant rows"
  ON buddy_read_participants FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM buddy_reads br
      WHERE br.id = buddy_read_id AND br.owner_id = auth.uid()
    )
    OR user_id = auth.uid()  -- self-join an open invite
  );

-- User updates their own participant row (status, current_page, etc.).
CREATE POLICY "User updates own participant row"
  ON buddy_read_participants FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM buddy_reads br
      WHERE br.id = buddy_read_id AND br.owner_id = auth.uid()
    )
  );

-- User can leave the buddy read.
CREATE POLICY "User can leave (delete own row)"
  ON buddy_read_participants FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM buddy_reads br
      WHERE br.id = buddy_read_id AND br.owner_id = auth.uid()
    )
  );

-- messages: participants only (any status — invited, joined, finished).
CREATE POLICY "Participants see messages"
  ON buddy_read_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM buddy_reads br
      WHERE br.id = buddy_read_id
        AND (
          br.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM buddy_read_participants p
            WHERE p.buddy_read_id = br.id AND p.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "Participants insert messages"
  ON buddy_read_messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM buddy_reads br
        WHERE br.id = buddy_read_id AND br.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM buddy_read_participants p
        WHERE p.buddy_read_id = buddy_read_id AND p.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "User deletes own messages"
  ON buddy_read_messages FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- Add buddy_read_invite and buddy_read_message notification types.
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
  'author_question',
  'buddy_read_invite',
  'buddy_read_message'
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
  'author_question',
  'buddy_read_invite',
  'buddy_read_message'
));


NOTIFY pgrst, 'reload schema';
