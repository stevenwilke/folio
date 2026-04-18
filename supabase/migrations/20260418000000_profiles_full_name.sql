-- Stores the full name returned by Sign in with Apple on first authorization.
-- Apple only returns fullName once per user, so this is populated on signup and never overwritten.
alter table profiles add column if not exists full_name text;
