-- Add level column to profiles for the gamification system.
-- Level is derived from earned badges (see src/lib/level.js) and kept in sync
-- by the client when the user visits their Stats page.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS level_points integer NOT NULL DEFAULT 0;
