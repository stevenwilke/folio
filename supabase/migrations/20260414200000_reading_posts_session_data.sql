-- Add session_data jsonb column for Strava-style reading activity cards
-- Stores: { pages_read, duration_min, start_page, end_page, total_pages, speed_ppm }
ALTER TABLE reading_posts ADD COLUMN IF NOT EXISTS session_data jsonb;
