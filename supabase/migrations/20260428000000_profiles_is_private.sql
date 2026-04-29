-- Private mode for user profiles. When is_private = true:
--   - The user is hidden from every public-facing surface (profile, library,
--     posts, quotes, club member lists, search, leaderboards, etc.).
--   - The user cannot initiate social actions (post, comment, recommend,
--     friend-request, join club, drop a book, etc.). Insert RLS policies on
--     each social table reject inserts where the actor is private.
--   - Existing data is preserved; turning private off restores all visibility.
--
-- This satisfies Google Play's "Can interactions in the app be limited to
-- invited friends only?" question by giving users a binary opt-out — the
-- most-restrictive form of audience control. A friends-only middle tier may
-- come later but is not in scope here.

alter table profiles
  add column if not exists is_private boolean not null default false;

create index if not exists profiles_is_private_idx
  on profiles(is_private) where is_private = true;

-- SECURITY DEFINER helper used by RLS policies on dependent tables. Bypasses
-- their own profiles RLS so we can answer "is this owner private?" from
-- inside a policy on, e.g., reading_posts. Returns false if the user_id is
-- null or the profile is missing — those cases are handled by the calling
-- policy's existing checks.
create or replace function public.is_user_private(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_private from profiles where id = p_user_id),
    false
  );
$$;

grant execute on function public.is_user_private(uuid) to authenticated, anon;

comment on column profiles.is_private is
  'When true, the user is hidden from public surfaces and cannot initiate social actions. See migration 20260428000000.';
comment on function public.is_user_private(uuid) is
  'RLS helper — returns true if the given user has private mode enabled.';
