-- Rate-limit match_contacts_by_email
--
-- The original RPC took an array of up to 50 emails per call and returned
-- public profile data for any matches. With no rate limit, an authenticated
-- user could probe arbitrary email lists to enumerate which addresses have
-- accounts. Cap both per-call size and per-user volume per hour.

-- Audit table — records every lookup. Used both for rate limiting and for
-- abuse forensics. Old rows are pruned on each call (no separate cron needed).
create table if not exists contact_lookups (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  email_count int         not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_contact_lookups_user_recent
  on contact_lookups (user_id, created_at desc);

alter table contact_lookups enable row level security;
-- Users can read their own lookups; only the SECURITY DEFINER RPC writes.
drop policy if exists contact_lookups_self_select on contact_lookups;
do $do$
begin
  create policy contact_lookups_self_select
    on contact_lookups for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null;
end $do$;

create or replace function match_contacts_by_email(emails text[])
returns table (
  id         uuid,
  username   text,
  avatar_url text
)
language plpgsql security definer stable set search_path = public
as $match_contacts$
declare
  v_uid          uuid := auth.uid();
  v_input_count  int  := coalesce(array_length(emails, 1), 0);
  v_recent_count int;
  -- Per-call cap: typical contact import is well under this.
  c_max_per_call constant int := 100;
  -- Per-user cap: total emails looked up in the last hour.
  c_max_per_hour constant int := 500;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_input_count = 0 then
    return;
  end if;
  if v_input_count > c_max_per_call then
    raise exception 'Too many emails per call (max %)', c_max_per_call using errcode = '22023';
  end if;

  -- Prune old audit rows opportunistically so the table stays small.
  delete from contact_lookups where created_at < now() - interval '24 hours';

  select coalesce(sum(email_count), 0) into v_recent_count
    from contact_lookups
    where user_id = v_uid and created_at > now() - interval '1 hour';

  if v_recent_count + v_input_count > c_max_per_hour then
    raise exception 'Contact lookup rate limit exceeded. Try again later.'
      using errcode = '22023';
  end if;

  insert into contact_lookups (user_id, email_count) values (v_uid, v_input_count);

  return query
    select p.id, p.username, p.avatar_url
    from profiles p
    join auth.users u on u.id = p.id
    where lower(u.email) = any (select lower(e) from unnest(emails) as e)
      and u.id <> v_uid
    limit 50;
end
$match_contacts$;

revoke execute on function match_contacts_by_email(text[]) from public;
grant  execute on function match_contacts_by_email(text[]) to authenticated;

notify pgrst, 'reload schema';
