-- ─── RPC: match_contacts_by_email ────────────────────────────────────────────
-- Given an array of email addresses, returns public profile rows whose
-- auth.users email matches. Uses SECURITY DEFINER so it can read auth.users
-- without exposing that table to clients directly.
create or replace function match_contacts_by_email(emails text[])
returns table (
  id         uuid,
  username   text,
  avatar_url text
)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.username, p.avatar_url
  from profiles p
  join auth.users u on u.id = p.id
  where lower(u.email) = any(
    select lower(e) from unnest(emails) as e
  )
  and u.id <> auth.uid()   -- exclude yourself
  limit 50;
$$;

-- Only authenticated users can call this
revoke execute on function match_contacts_by_email(text[]) from public;
grant  execute on function match_contacts_by_email(text[]) to authenticated;

notify pgrst, 'reload schema';
