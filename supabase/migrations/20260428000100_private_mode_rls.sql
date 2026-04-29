-- Phase 2 of private profile feature (see 20260428000000_profiles_is_private.sql).
--
-- Two-way wall: when profiles.is_private = true,
--   (a) the user's social content disappears from public read surfaces, and
--   (b) the user cannot insert into the social tables — full opt-out.
--
-- Each policy is rewritten with a self-exception so the user always sees
-- their own data regardless of privacy state. Other users' data is gated by
-- public.is_user_private(user_id).

-- Each policy is dropped under both its old and new names so the migration
-- is fully idempotent — safe to re-apply if a previous run errored midway.

-- ── reading_posts ──────────────────────────────────────────────────────
drop policy if exists "Anyone can read posts" on reading_posts;
drop policy if exists "Public can read non-private authors' posts" on reading_posts;
create policy "Public can read non-private authors' posts"
  on reading_posts for select
  using (auth.uid() = user_id or not public.is_user_private(user_id));

drop policy if exists "Users insert own posts" on reading_posts;
drop policy if exists "Users insert own posts (when not private)" on reading_posts;
create policy "Users insert own posts (when not private)"
  on reading_posts for insert
  with check (auth.uid() = user_id and not public.is_user_private(auth.uid()));

-- ── post_likes (user_id is the liker) ──────────────────────────────────
drop policy if exists "Anyone can read likes" on post_likes;
drop policy if exists "Public can read non-private likers' likes" on post_likes;
create policy "Public can read non-private likers' likes"
  on post_likes for select
  using (auth.uid() = user_id or not public.is_user_private(user_id));

drop policy if exists "Users insert own likes" on post_likes;
drop policy if exists "Users insert own likes (when not private)" on post_likes;
create policy "Users insert own likes (when not private)"
  on post_likes for insert
  with check (auth.uid() = user_id and not public.is_user_private(auth.uid()));

-- ── post_comments (user_id is the commenter) ──────────────────────────
drop policy if exists "Anyone can read comments" on post_comments;
drop policy if exists "Public can read non-private commenters' comments" on post_comments;
create policy "Public can read non-private commenters' comments"
  on post_comments for select
  using (auth.uid() = user_id or not public.is_user_private(user_id));

drop policy if exists "Users insert own comments" on post_comments;
drop policy if exists "Users insert own comments (when not private)" on post_comments;
create policy "Users insert own comments (when not private)"
  on post_comments for insert
  with check (auth.uid() = user_id and not public.is_user_private(auth.uid()));

-- ── book_quotes ────────────────────────────────────────────────────────
drop policy if exists "Anyone can read quotes" on book_quotes;
drop policy if exists "Public can read non-private users' quotes" on book_quotes;
create policy "Public can read non-private users' quotes"
  on book_quotes for select
  using (auth.uid() = user_id or not public.is_user_private(user_id));

drop policy if exists "Users insert own quotes" on book_quotes;
drop policy if exists "Users insert own quotes (when not private)" on book_quotes;
create policy "Users insert own quotes (when not private)"
  on book_quotes for insert
  with check (auth.uid() = user_id and not public.is_user_private(auth.uid()));

-- ── book_drops ─────────────────────────────────────────────────────────
drop policy if exists "Anyone can read book drops" on book_drops;
drop policy if exists "Public can read non-private users' book drops" on book_drops;
create policy "Public can read non-private users' book drops"
  on book_drops for select
  using (auth.uid() = user_id or not public.is_user_private(user_id));

drop policy if exists "Authenticated users can create drops" on book_drops;
drop policy if exists "Authenticated users can create drops (when not private)" on book_drops;
create policy "Authenticated users can create drops (when not private)"
  on book_drops for insert
  with check (auth.uid() = user_id and not public.is_user_private(auth.uid()));

-- ── little_libraries ──────────────────────────────────────────────────
drop policy if exists "Anyone can read little libraries" on little_libraries;
drop policy if exists "Public can read non-private owners' libraries" on little_libraries;
create policy "Public can read non-private owners' libraries"
  on little_libraries for select
  using (
    auth.uid() = user_id
    or user_id is null  -- OSM-imported libraries have no owner
    or not public.is_user_private(user_id)
  );

drop policy if exists "Authenticated users can add libraries" on little_libraries;
drop policy if exists "Authenticated users can add libraries (when not private)" on little_libraries;
create policy "Authenticated users can add libraries (when not private)"
  on little_libraries for insert
  with check (auth.uid() = user_id and not public.is_user_private(auth.uid()));

-- ── little_library_scans ──────────────────────────────────────────────
drop policy if exists "Anyone can read scans" on little_library_scans;
drop policy if exists "Public can read non-private scanners' scans" on little_library_scans;
create policy "Public can read non-private scanners' scans"
  on little_library_scans for select
  using (auth.uid() = user_id or not public.is_user_private(user_id));

drop policy if exists "Authenticated users can add scans" on little_library_scans;
drop policy if exists "Authenticated users can add scans (when not private)" on little_library_scans;
create policy "Authenticated users can add scans (when not private)"
  on little_library_scans for insert
  with check (auth.uid() = user_id and not public.is_user_private(auth.uid()));

-- ── book_club_members ─────────────────────────────────────────────────
-- Private users disappear from membership lists for everyone except themselves.
-- Co-members of a club they joined before going private also lose visibility,
-- which is the conservative read of "fully opt out of being seen."
drop policy if exists "Authenticated users can view memberships" on book_club_members;
drop policy if exists "View memberships (private members hidden)" on book_club_members;
create policy "View memberships (private members hidden)"
  on book_club_members for select
  using (auth.uid() = user_id or not public.is_user_private(user_id));

drop policy if exists "Users can join public clubs or be invited" on book_club_members;
drop policy if exists "Users join public clubs or be invited (when not private)" on book_club_members;
create policy "Users join public clubs or be invited (when not private)"
  on book_club_members for insert
  with check (
    auth.uid() = user_id
    and not public.is_user_private(auth.uid())
    and (
      exists (select 1 from book_clubs where id = club_id and is_public = true)
      or exists (
        select 1 from book_club_members m
        where m.club_id = book_club_members.club_id
          and m.user_id = auth.uid()
          and m.role in ('admin', 'invited')
      )
    )
  );

-- ── book_clubs (creating new clubs) ───────────────────────────────────
drop policy if exists "Authenticated users can create clubs" on book_clubs;
drop policy if exists "Authenticated users can create clubs (when not private)" on book_clubs;
create policy "Authenticated users can create clubs (when not private)"
  on book_clubs for insert
  with check (auth.uid() = created_by and not public.is_user_private(auth.uid()));

-- ── friendships ───────────────────────────────────────────────────────
-- Block private users from sending OR accepting friend requests. The Phase 5
-- housekeeping RPC auto-cancels pending requests at toggle time, so this is
-- the steady-state guard.
-- friendships lives outside the migration tree (created in the Supabase
-- dashboard), so we guard the policy installs behind an existence check.
-- One EXECUTE per statement — keeps the file free of nested dollar quotes
-- so it parses cleanly in editors that don't fully support them.
do $do$
begin
  if exists (select 1 from pg_class where relname = 'friendships') then
    execute 'drop policy if exists friendships_insert_when_not_private on friendships';
    execute 'create policy friendships_insert_when_not_private on friendships '
         || 'for insert '
         || 'with check ('
         ||   'auth.uid() = requester_id '
         ||   'and not public.is_user_private(auth.uid()) '
         ||   'and not public.is_user_private(addressee_id)'
         || ')';

    execute 'drop policy if exists friendships_update_when_not_private on friendships';
    execute 'create policy friendships_update_when_not_private on friendships '
         || 'for update '
         || 'using (auth.uid() in (requester_id, addressee_id)) '
         || 'with check ('
         ||   'auth.uid() in (requester_id, addressee_id) '
         ||   'and not public.is_user_private(auth.uid())'
         || ')';
  end if;
end
$do$;

-- ── public_reviews view ───────────────────────────────────────────────
-- Filter out reviews authored by private users. The view is SECURITY DEFINER
-- (security_invoker = false), so we have to enforce the privacy check inside
-- the view body itself — RLS on collection_entries doesn't apply.
create or replace view public_reviews as
  select
    ce.id,
    ce.book_id,
    ce.user_rating,
    ce.review_text,
    ce.added_at,
    p.username,
    p.avatar_url
  from collection_entries ce
  join profiles p on p.id = ce.user_id
  where ce.review_text is not null
    and not coalesce(p.is_private, false);

alter view public_reviews set (security_invoker = false);
grant select on public_reviews to anon, authenticated;
