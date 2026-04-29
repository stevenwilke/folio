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
LANGUAGE sql STABLE SECURITY DEFINER
AS $recent_reviews$
  SELECT
    ce.id, ce.book_id, b.title, ce.review_text, ce.user_rating, ce.added_at,
    p.username, p.avatar_url
  FROM collection_entries ce
  JOIN books b    ON b.id = ce.book_id
  JOIN profiles p ON p.id = ce.user_id
  WHERE NOT coalesce(p.is_private, false)
    AND ce.review_text IS NOT NULL
    AND length(trim(ce.review_text)) > 0
    AND (
      lower(b.author) = lower(p_author_name)
      OR b.author ILIKE (p_author_name || ',%')
      OR b.author ILIKE ('%, ' || p_author_name)
      OR b.author ILIKE ('%, ' || p_author_name || ',%')
    )
    AND (
      EXISTS (SELECT 1 FROM authors a WHERE lower(a.name) = lower(p_author_name) AND a.claimed_by = auth.uid() AND a.is_verified)
      OR EXISTS (SELECT 1 FROM profiles pp WHERE pp.id = auth.uid() AND pp.is_admin)
    )
  ORDER BY ce.added_at DESC
  LIMIT greatest(p_limit, 1)
$recent_reviews$;

GRANT EXECUTE ON FUNCTION get_author_recent_reviews(text, int) TO authenticated;
NOTIFY pgrst, 'reload schema';
