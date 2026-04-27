-- Author posts: new notification type for "an author you follow posted" + a
-- weekly stats helper for the Author Dashboard trends chart.

-- 1. Add 'author_post' to both notification CHECK constraints.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'friend_request', 'friend_accepted',
  'borrow_request', 'borrow_approved', 'borrow_returned',
  'order_update', 'recommendation', 'club_activity',
  'achievement', 'quote_shared', 'book_drop_claimed',
  'stale_reading',
  'author_claim',
  'author_post'
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
  'author_post'
));


-- 2. Weekly stats for the Author Dashboard trends chart.
-- Returns 12 rows (one per week, oldest first), with new_readers / new_quotes /
-- new_reviews counts for that week. Same access gate as other dashboard helpers.
DROP FUNCTION IF EXISTS get_author_weekly_stats(text);

CREATE FUNCTION get_author_weekly_stats(p_author_name text)
RETURNS TABLE (
  week_start    date,
  new_readers   bigint,
  new_quotes    bigint,
  new_reviews   bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $body$
  WITH weeks AS (
    SELECT generate_series(
      date_trunc('week', current_date - interval '11 weeks')::date,
      date_trunc('week', current_date)::date,
      interval '1 week'
    )::date AS week_start
  ),
  matched_books AS (
    SELECT b.id
    FROM books b
    WHERE (
        lower(b.author) = lower(p_author_name)
        OR b.author ILIKE (p_author_name || ',%')
        OR b.author ILIKE ('%, ' || p_author_name)
        OR b.author ILIKE ('%, ' || p_author_name || ',%')
      )
      AND (
        EXISTS (
          SELECT 1 FROM authors a
          WHERE lower(a.name) = lower(p_author_name)
            AND a.claimed_by = auth.uid()
            AND a.is_verified = true
        )
        OR EXISTS (
          SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true
        )
      )
  ),
  reader_counts AS (
    SELECT date_trunc('week', ce.added_at)::date AS w, count(DISTINCT ce.user_id) AS n
    FROM collection_entries ce
    JOIN matched_books mb ON mb.id = ce.book_id
    WHERE ce.added_at >= date_trunc('week', current_date - interval '11 weeks')
    GROUP BY 1
  ),
  quote_counts AS (
    SELECT date_trunc('week', q.created_at)::date AS w, count(*) AS n
    FROM book_quotes q
    JOIN matched_books mb ON mb.id = q.book_id
    WHERE q.created_at >= date_trunc('week', current_date - interval '11 weeks')
    GROUP BY 1
  ),
  review_counts AS (
    SELECT date_trunc('week', ce.added_at)::date AS w, count(*) AS n
    FROM collection_entries ce
    JOIN matched_books mb ON mb.id = ce.book_id
    WHERE ce.added_at >= date_trunc('week', current_date - interval '11 weeks')
      AND ce.review_text IS NOT NULL
      AND length(trim(ce.review_text)) > 0
    GROUP BY 1
  )
  SELECT
    w.week_start,
    coalesce(rc.n, 0) AS new_readers,
    coalesce(qc.n, 0) AS new_quotes,
    coalesce(rv.n, 0) AS new_reviews
  FROM weeks w
  LEFT JOIN reader_counts rc ON rc.w = w.week_start
  LEFT JOIN quote_counts  qc ON qc.w = w.week_start
  LEFT JOIN review_counts rv ON rv.w = w.week_start
  ORDER BY w.week_start
$body$;

GRANT EXECUTE ON FUNCTION get_author_weekly_stats(text) TO authenticated;


NOTIFY pgrst, 'reload schema';
