-- Add format-specific used price columns to valuations
ALTER TABLE valuations ADD COLUMN IF NOT EXISTS paperback_avg numeric;
ALTER TABLE valuations ADD COLUMN IF NOT EXISTS hardcover_avg numeric;
