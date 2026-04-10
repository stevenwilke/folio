-- Add weekly reading report opt-in to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weekly_report_enabled boolean NOT NULL DEFAULT false;
