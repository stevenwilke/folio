-- Add format column to books table to distinguish book formats
ALTER TABLE books ADD COLUMN IF NOT EXISTS format text DEFAULT 'physical';

-- Ensure all existing rows have a valid value
UPDATE books SET format = 'physical' WHERE format IS NULL;

-- Drop overly restrictive constraint if it exists
ALTER TABLE books DROP CONSTRAINT IF EXISTS books_format_check;
