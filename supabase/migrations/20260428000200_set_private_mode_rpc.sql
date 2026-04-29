-- Phase 5+6: server-side housekeeping RPC for toggling private mode.
-- Comments live OUTSIDE the function body to keep the CREATE FUNCTION
-- statement small enough to slip past the Supabase dashboard SQL editor's
-- per-statement size handling, which has been truncating longer single
-- statements at submission time.
--
-- Behavior summary:
--   set_private_mode(false) -> profiles.is_private=false, is_public=true
--   set_private_mode(true)  -> refuses if user holds a verified author claim;
--                              auto-promotes next-oldest member when sole
--                              admin (or disbands solo clubs); cancels
--                              pending friend requests; declines pending
--                              buddy-read invites; flips both flags.
-- Returns a jsonb summary so the client can surface housekeeping side-effects.

create or replace function public.set_private_mode(p_private boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $set_private_mode$
declare
  v_uid uuid := auth.uid();
  v_author boolean;
  v_demoted int := 0;
  v_disbanded int := 0;
  v_friends int := 0;
  v_buddies int := 0;
  v_succ uuid;
  r record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_private = false then
    update profiles set is_private = false, is_public = true where id = v_uid;
    return jsonb_build_object('private', false);
  end if;

  select exists (select 1 from authors where claimed_by = v_uid and is_verified) into v_author;
  if v_author then
    raise exception 'Cannot enable private mode while you hold a verified author claim. Release the claim first.' using errcode = 'P0001';
  end if;

  for r in (
    select c.id as club_id from book_clubs c
    join book_club_members m on m.club_id = c.id and m.user_id = v_uid and m.role = 'admin'
    where not exists (
      select 1 from book_club_members m2
      where m2.club_id = c.id and m2.role = 'admin' and m2.user_id <> v_uid
    )
  ) loop
    select user_id into v_succ from book_club_members
      where club_id = r.club_id and user_id <> v_uid
      order by joined_at asc limit 1;
    if v_succ is not null then
      update book_club_members set role = 'admin' where club_id = r.club_id and user_id = v_succ;
      update book_club_members set role = 'member' where club_id = r.club_id and user_id = v_uid;
      v_demoted := v_demoted + 1;
    else
      delete from book_clubs where id = r.club_id;
      v_disbanded := v_disbanded + 1;
    end if;
  end loop;

  if exists (select 1 from pg_class where relname = 'friendships') then
    execute 'with c as (delete from friendships where status = ''pending'' and (requester_id = '
      || quote_literal(v_uid::text) || ' or addressee_id = ' || quote_literal(v_uid::text)
      || ') returning 1) select count(*) from c'
      into v_friends;
  end if;

  update buddy_read_participants set status = 'declined'
    where user_id = v_uid and status = 'invited';
  get diagnostics v_buddies = row_count;

  update profiles set is_private = true, is_public = false where id = v_uid;

  return jsonb_build_object(
    'private', true,
    'clubs_demoted', v_demoted,
    'clubs_disbanded', v_disbanded,
    'friend_requests_cancelled', v_friends,
    'buddy_invites_declined', v_buddies
  );
end;
$set_private_mode$;

grant execute on function public.set_private_mode(boolean) to authenticated;
