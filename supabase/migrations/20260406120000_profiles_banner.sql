-- Add profile banner image URL
alter table profiles
  add column if not exists banner_url text;
