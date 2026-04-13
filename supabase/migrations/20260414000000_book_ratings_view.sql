-- Aggregate rating view with star distribution
-- BookDetail already queries book_ratings; this adds distribution columns
CREATE OR REPLACE VIEW book_ratings AS
SELECT
  book_id,
  ROUND(AVG(user_rating)::numeric, 1) AS avg_rating,
  COUNT(*) AS rating_count,
  COUNT(*) FILTER (WHERE user_rating = 1) AS stars_1,
  COUNT(*) FILTER (WHERE user_rating = 2) AS stars_2,
  COUNT(*) FILTER (WHERE user_rating = 3) AS stars_3,
  COUNT(*) FILTER (WHERE user_rating = 4) AS stars_4,
  COUNT(*) FILTER (WHERE user_rating = 5) AS stars_5
FROM collection_entries
WHERE user_rating IS NOT NULL
GROUP BY book_id;
