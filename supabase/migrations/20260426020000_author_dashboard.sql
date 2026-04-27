-- Author Dashboard support: notification type + SECURITY DEFINER stat helpers.
-- All functions are language sql with single-SELECT bodies (no semicolons inside
-- the dollar-quoted bodies) so they parse cleanly in Supabase Studio's SQL editor.

-- 1. Allow author_claim notifications.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'friend_request', 'friend_accepted',
  'borrow_request', 'borrow_approved', 'borrow_returned',
  'order_update', 'recommendation', 'club_activity',
  'achievement', 'quote_shared', 'book_drop_claimed',
  'stale_reading',
  'author_claim'
));


-- 2. Caller's claimed authors.
DROP FUNCTION IF EXISTS get_my_claimed_authors();

CREATE FUNCTION get_my_claimed_authors()
RETURNS TABLE (id uuid, name text, is_verified boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $body$
  SELECT a.id, a.name, a.is_verified
  FROM authors a
  WHERE a.claimed_by = auth.uid() AND a.is_verified = true
$body$;

GRANT EXECUTE ON FUNCTION get_my_claimed_authors() TO authenticated;


-- 3. Aggregated per-book stats. Caller must own a verified claim OR be admin.
DROP FUNCTION IF EXISTS get_author_book_stats(text);

CREATE FUNCTION get_author_book_stats(p_author_name text)
RETURNS TABLE (
  book_id         uuid,
  title           text,
  cover_image_url text,
  in_library      bigint,
  read_count      bigint,
  reading_count   bigint,
  want_count      bigint,
  rating_count    bigint,
  avg_rating      numeric,
  review_count    bigint,
  quote_count     bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $body$
  SELECT
    b.id,
    b.title,
    b.cover_image_url,
    count(*) FILTER (WHERE ce.id IS NOT NULL),
    count(*) FILTER (WHERE ce.read_status = 'read' OR ce.has_read = true),
    count(*) FILTER (WHERE ce.read_status = 'reading'),
    count(*) FILTER (WHERE ce.read_status = 'want'),
    count(*) FILTER (WHERE ce.user_rating > 0),
    round(avg(nullif(ce.user_rating, 0))::numeric, 2),
    count(*) FILTER (WHERE ce.review_text IS NOT NULL AND length(trim(ce.review_text)) > 0),
    coalesce(q.quote_count, 0)
  FROM books b
  LEFT JOIN collection_entries ce ON ce.book_id = b.id
  LEFT JOIN (
    SELECT bq.book_id, count(*)::bigint AS quote_count
    FROM book_quotes bq
    GROUP BY bq.book_id
  ) q ON q.book_id = b.id
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
  GROUP BY b.id, b.title, b.cover_image_url, q.quote_count
  ORDER BY count(*) FILTER (WHERE ce.id IS NOT NULL) DESC, b.title
$body$;

GRANT EXECUTE ON FUNCTION get_author_book_stats(text) TO authenticated;


-- 4. Recent quotes for an author.
DROP FUNCTION IF EXISTS get_author_recent_quotes(text, int);

CREATE FUNCTION get_author_recent_quotes(p_author_name text, p_limit int DEFAULT 20)
RETURNS TABLE (
  id          uuid,
  book_id     uuid,
  book_title  text,
  quote_text  text,
  page_number integer,
  created_at  timestamptz,
  username    text,
  avatar_url  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $body$
  SELECT
    bq.id, bq.book_id, b.title, bq.quote_text, bq.page_number, bq.created_at,
    p.username, p.avatar_url
  FROM book_quotes bq
  JOIN books b    ON b.id = bq.book_id
  JOIN profiles p ON p.id = bq.user_id
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
        SELECT 1 FROM profiles pp WHERE pp.id = auth.uid() AND pp.is_admin = true
      )
    )
  ORDER BY bq.created_at DESC
  LIMIT greatest(p_limit, 1)
$body$;

GRANT EXECUTE ON FUNCTION get_author_recent_quotes(text, int) TO authenticated;


-- 5. Recent reviews for an author.
DROP FUNCTION IF EXISTS get_author_recent_reviews(text, int);

CREATE FUNCTION get_author_recent_reviews(p_author_name text, p_limit int DEFAULT 20)
RETURNS TABLE (
  id          uuid,
  book_id     uuid,
  book_title  text,
  review_text text,
  user_rating integer,
  added_at    timestamptz,
  username    text,
  avatar_url  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $body$
  SELECT
    ce.id, ce.book_id, b.title, ce.review_text, ce.user_rating, ce.added_at,
    p.username, p.avatar_url
  FROM collection_entries ce
  JOIN books b    ON b.id = ce.book_id
  JOIN profiles p ON p.id = ce.user_id
  WHERE ce.review_text IS NOT NULL
    AND length(trim(ce.review_text)) > 0
    AND (
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
        SELECT 1 FROM profiles pp WHERE pp.id = auth.uid() AND pp.is_admin = true
      )
    )
  ORDER BY ce.added_at DESC
  LIMIT greatest(p_limit, 1)
$body$;

GRANT EXECUTE ON FUNCTION get_author_recent_reviews(text, int) TO authenticated;


NOTIFY pgrst, 'reload schema';
