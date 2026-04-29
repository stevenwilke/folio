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
LANGUAGE sql STABLE SECURITY DEFINER
AS $recent_quotes$
  SELECT
    bq.id, bq.book_id, b.title, bq.quote_text, bq.page_number, bq.created_at,
    p.username, p.avatar_url
  FROM book_quotes bq
  JOIN books b    ON b.id = bq.book_id
  JOIN profiles p ON p.id = bq.user_id
  WHERE NOT coalesce(p.is_private, false)
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
  ORDER BY bq.created_at DESC
  LIMIT greatest(p_limit, 1)
$recent_quotes$;

GRANT EXECUTE ON FUNCTION get_author_recent_quotes(text, int) TO authenticated;
NOTIFY pgrst, 'reload schema';
