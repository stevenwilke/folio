-- Add last_sign_in_at to profiles, synced from auth.users
alter table profiles add column if not exists last_sign_in_at timestamptz;

-- Backfill from auth.users
update profiles p
  set last_sign_in_at = u.last_sign_in_at
  from auth.users u
  where u.id = p.id;

-- Trigger function: copy last_sign_in_at whenever auth.users row is updated
create or replace function public.sync_last_sign_in()
returns trigger
language plpgsql
security definer
as $$
begin
  update profiles
    set last_sign_in_at = new.last_sign_in_at
    where id = new.id;
  return new;
exception when others then
  return new;  -- never block auth
end;
$$;

-- Fire after every update on auth.users (Supabase updates this on sign-in)
drop trigger if exists on_auth_user_updated_sync_sign_in on auth.users;
create trigger on_auth_user_updated_sync_sign_in
  after update on auth.users
  for each row
  when (old.last_sign_in_at is distinct from new.last_sign_in_at)
  execute function public.sync_last_sign_in();
