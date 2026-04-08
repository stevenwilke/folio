-- Make usernames case-insensitive unique.
-- A unique index on lower(username) prevents "Steven" and "steven" from coexisting.
create unique index if not exists idx_profiles_username_lower
  on profiles (lower(username));

notify pgrst, 'reload schema';
