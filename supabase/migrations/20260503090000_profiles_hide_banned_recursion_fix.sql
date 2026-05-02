-- HOTFIX: profiles_hide_banned (added in 20260503020000_data_integrity.sql)
-- caused infinite RLS recursion. The `exists (select 1 from profiles p ...)`
-- subquery on `profiles` triggers the same policy again. Every SELECT on
-- profiles started returning 500 Internal Server Error.
--
-- Fix: extract the admin check into a SECURITY DEFINER function that
-- bypasses RLS, then call it from the policy. Same pattern as
-- public.is_user_private and public.is_user_banned.

-- ── 1. Helper: is the given user an admin? ──────────────────────────────────
create or replace function public.is_user_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $is_user_admin$
  select coalesce((select is_admin from profiles where id = p_user_id), false)
$is_user_admin$;

-- ── 2. Replace the recursive policy ─────────────────────────────────────────
drop policy if exists profiles_hide_banned on profiles;
do $do$
begin
  create policy profiles_hide_banned
    on profiles as restrictive for select
    using (
      coalesce(is_banned, false) = false
      or auth.uid() = id
      or public.is_user_admin(auth.uid())
    );
exception when duplicate_object then null;
end $do$;
