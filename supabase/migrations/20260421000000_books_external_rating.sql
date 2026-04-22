-- External (Google Books / Open Library / etc.) ratings stored on the books
-- table. Used as a fallback when no Ex Libris user has rated the book yet —
-- once the community rating exists, the UI ignores these columns.

ALTER TABLE books ADD COLUMN IF NOT EXISTS external_rating          numeric(3,2);   -- 1.00 - 5.00
ALTER TABLE books ADD COLUMN IF NOT EXISTS external_rating_count    integer;
ALTER TABLE books ADD COLUMN IF NOT EXISTS external_rating_source   text;           -- 'google_books' | 'open_library'
ALTER TABLE books ADD COLUMN IF NOT EXISTS external_rating_fetched_at timestamptz;
