-- Security lockdowns from audit
--
-- 1. notifications: was INSERT WITH CHECK (true) — let any client (incl. anon)
--    write any notification to any user_id. Add actor_id audit column,
--    require auth + actor = self.
-- 2. books: was UPDATE open to all authenticated — title/author vandalism
--    risk. Add trigger that blocks non-admin changes to identity columns.
-- 3. authors: INSERT was WITH CHECK (true). Add created_by audit column,
--    require auth + creator = self.

-- ── 1. notifications ──────────────────────────────────────────────────────────

alter table notifications
  add column if not exists actor_id uuid references auth.users(id) on delete set null;

alter table notifications
  alter column actor_id set default auth.uid();

create index if not exists idx_notifications_actor on notifications(actor_id)
  where actor_id is not null;

drop policy if exists "Anyone can insert notifications" on notifications;
drop policy if exists "Auth users insert notifications as self actor" on notifications;

-- Authenticated users may only insert notifications where they record themselves
-- as the actor. This makes spam traceable and bans anonymous spam entirely.
-- Wrapped in DO/EXCEPTION so this is bulletproof under partial-rerun.
do $do$
begin
  create policy "Auth users insert notifications as self actor"
    on notifications for insert to authenticated
    with check (auth.uid() is not null and actor_id = auth.uid());
exception when duplicate_object then null;
end $do$;

-- Service role (used by edge functions) bypasses RLS as usual.

-- ── 2. books: prevent non-admin vandalism of title / author ───────────────────

create or replace function prevent_book_identity_changes()
returns trigger language plpgsql security definer set search_path = public as $prevent_book_identity_changes$
declare is_admin_user boolean;
begin
  if (new.title is distinct from old.title) or (new.author is distinct from old.author) then
    select coalesce(is_admin, false) into is_admin_user
      from profiles where id = auth.uid();
    if not coalesce(is_admin_user, false) then
      raise exception 'Only admins can change book title or author. Submit a correction instead.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $prevent_book_identity_changes$;

drop trigger if exists trg_prevent_book_identity_changes on books;
create trigger trg_prevent_book_identity_changes
  before update on books
  for each row execute function prevent_book_identity_changes();

-- ── 3. authors: track creator, allow audit / takedown ────────────────────────

alter table authors
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table authors
  alter column created_by set default auth.uid();

create index if not exists idx_authors_created_by on authors(created_by)
  where created_by is not null;

drop policy if exists "Authenticated can insert authors" on authors;
drop policy if exists "Auth users insert authors as self creator" on authors;

do $do$
begin
  create policy "Auth users insert authors as self creator"
    on authors for insert to authenticated
    with check (auth.uid() is not null and created_by = auth.uid());
exception when duplicate_object then null;
end $do$;
