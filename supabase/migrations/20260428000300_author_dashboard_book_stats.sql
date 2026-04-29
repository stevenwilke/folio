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
LANGUAGE sql STABLE SECURITY DEFINER
AS $book_stats$
  SELECT
    b.id, b.title, b.cover_image_url,
    count(*) FILTER (WHERE ce.id IS NOT NULL),
    count(*) FILTER (WHERE ce.read_status = 'read' OR ce.has_read = true),
    count(*) FILTER (WHERE ce.read_status = 'reading'),
    count(*) FILTER (WHERE ce.read_status = 'want'),
    count(*) FILTER (WHERE ce.user_rating > 0),
    round(avg(nullif(ce.user_rating, 0))::numeric, 2),
    count(*) FILTER (WHERE ce.review_text IS NOT NULL AND length(trim(ce.review_text)) > 0),
    coalesce(q.quote_count, 0)
  FROM books b
  LEFT JOIN collection_entries ce
    ON ce.book_id = b.id AND NOT public.is_user_private(ce.user_id)
  LEFT JOIN (
    SELECT bq.book_id, count(*)::bigint AS quote_count
    FROM book_quotes bq
    WHERE NOT public.is_user_private(bq.user_id)
    GROUP BY bq.book_id
  ) q ON q.book_id = b.id
  WHERE (
      lower(b.author) = lower(p_author_name)
      OR b.author ILIKE (p_author_name || ',%')
      OR b.author ILIKE ('%, ' || p_author_name)
      OR b.author ILIKE ('%, ' || p_author_name || ',%')
    )
    AND (
      EXISTS (SELECT 1 FROM authors a WHERE lower(a.name) = lower(p_author_name) AND a.claimed_by = auth.uid() AND a.is_verified)
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin)
    )
  GROUP BY b.id, b.title, b.cover_image_url, q.quote_count
  ORDER BY count(*) FILTER (WHERE ce.id IS NOT NULL) DESC, b.title
$book_stats$;

GRANT EXECUTE ON FUNCTION get_author_book_stats(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
