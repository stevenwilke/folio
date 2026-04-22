-- Per-entry owned formats + copy counts for multi-copy collectors.
-- A user might own the same book in Hardcover AND Paperback AND eBook, and
-- serious collectors might own multiple copies of the same format (e.g. 3
-- signed first-edition Hardcovers). The legacy `books.format` column was a
-- single global value and couldn't express any of that.
--
-- Shape: { "Hardcover": 2, "Paperback": 1, "eBook": 1 }
--   - key present => user owns at least one copy of that format
--   - value       => number of copies (always >= 1 when key is present)
--
-- Populated per-user so two users can own different format combinations of the
-- same book without stomping each other.

ALTER TABLE collection_entries
  ADD COLUMN IF NOT EXISTS format_copies jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: for any existing entry that has no formats yet, seed it with a
-- single copy of the book's legacy `format` value so nothing appears to lose
-- a format on deploy.
UPDATE collection_entries ce
SET format_copies = jsonb_build_object(b.format, 1)
FROM books b
WHERE ce.book_id = b.id
  AND (ce.format_copies = '{}'::jsonb OR ce.format_copies IS NULL)
  AND b.format IS NOT NULL
  AND b.format <> '';
