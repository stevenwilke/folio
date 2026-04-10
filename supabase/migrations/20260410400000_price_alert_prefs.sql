-- Add price alerts preference to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS price_alerts_enabled boolean NOT NULL DEFAULT true;
