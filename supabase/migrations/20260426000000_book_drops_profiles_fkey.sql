-- book_drops.user_id and claimed_by reference auth.users(id), so PostgREST
-- cannot resolve profiles(...) embeds against them. Add redundant FKs to
-- profiles(id) so `profiles:user_id(...)` and `claimer:claimed_by(...)`
-- selects resolve. profiles.id is itself a 1:1 FK to auth.users(id), so
-- the new constraints can never disagree with the existing ones.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'book_drops_user_profiles_fkey'
  ) then
    alter table book_drops
      add constraint book_drops_user_profiles_fkey
      foreign key (user_id) references profiles(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'book_drops_claimer_profiles_fkey'
  ) then
    alter table book_drops
      add constraint book_drops_claimer_profiles_fkey
      foreign key (claimed_by) references profiles(id) on delete set null;
  end if;
end $$;
