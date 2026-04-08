-- Add display_name to authors — overrides the shown name while keeping `name` as the lookup key
ALTER TABLE authors ADD COLUMN IF NOT EXISTS display_name text;
