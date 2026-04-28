-- Prevent demoting the last remaining admin and prevent self-demotion.
create or replace function public.protect_last_admin()
returns trigger
language plpgsql
security definer
as $$
begin
  if old.is_admin = true and new.is_admin = false then
    if new.id = auth.uid() then
      raise exception 'admins cannot remove their own admin access';
    end if;
    if (select count(*) from profiles where is_admin = true and id <> old.id) = 0 then
      raise exception 'cannot remove the last admin';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_last_admin on profiles;
create trigger profiles_protect_last_admin
  before update of is_admin on profiles
  for each row
  when (old.is_admin is distinct from new.is_admin)
  execute function public.protect_last_admin();
