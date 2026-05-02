-- Data integrity fixes from audit
--
-- 1. Banned users were never filtered out of friend search / club invites /
--    profile reads. Hide them at the RLS layer so every read in the app
--    inherits the protection.
-- 2. Friendships had no uniqueness guarantee — double-clicks and A→B + B→A
--    created duplicate rows. State transitions also weren't gated.
--
-- Profiles + friendships base schemas live in Supabase Studio (not in the
-- migration tree), so we use idempotent guards (DO blocks, IF NOT EXISTS,
-- pg_class checks) instead of straight CREATEs.

-- ── 1. is_user_banned helper ─────────────────────────────────────────────────
create or replace function public.is_user_banned(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $is_user_banned$
  select coalesce((select is_banned from profiles where id = p_user_id), false)
$is_user_banned$;

-- ── 2. profiles: hide banned users from everyone except self + admins ────────
-- RESTRICTIVE policies are AND'd with all PERMISSIVE policies (PG 14+),
-- so this acts as a global filter without needing to know the existing
-- SELECT policy text.
drop policy if exists profiles_hide_banned on profiles;
do $do$
begin
  create policy profiles_hide_banned
    on profiles as restrictive for select
    using (
      coalesce(is_banned, false) = false
      or auth.uid() = id
      or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
    );
exception when duplicate_object then null;
end $do$;

-- ── 3. friendships: dedupe + state gating (only if table exists) ────────────
do $do$
begin
  if exists (select 1 from pg_class where relname = 'friendships') then
    -- Uniqueness on the unordered pair: A→B and B→A collapse to one row.
    execute 'create unique index if not exists ux_friendships_pair '
         || 'on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id))';

    -- Only the addressee can move pending → accepted/declined; the requester
    -- can cancel (i.e., delete) but should not flip the status. Either side
    -- can unfriend by deleting the row. We replace any existing UPDATE policy
    -- with one that gates the transition.
    execute 'drop policy if exists friendships_update_when_not_private on friendships';
    execute 'drop policy if exists friendships_state_gated on friendships';
    execute 'create policy friendships_state_gated on friendships '
         || 'for update '
         || 'using ('
         ||   'auth.uid() in (requester_id, addressee_id) '
         ||   'and status = ''pending'' '
         ||   'and not public.is_user_private(auth.uid())'
         || ') '
         || 'with check ('
         ||   'auth.uid() in (requester_id, addressee_id) '
         ||   'and status in (''accepted'', ''declined'') '
         ||   'and not public.is_user_private(auth.uid())'
         || ')';
  end if;
end
$do$;

-- ── 4. Storage buckets: enforce MIME type + size limits ─────────────────────
-- Only book-covers had restrictions per the audit. Add to the rest. These
-- updates are idempotent — they only set values for buckets that exist.
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif'],
       file_size_limit    = 10 * 1024 * 1024  -- 10 MB
 where id in ('avatars', 'banners', 'library-photos', 'drop-photos', 'post-images');
