-- Fix mutual RLS recursion between buddy_reads and buddy_read_participants.
-- The original SELECT policies referenced each other, causing 42P17
-- ("infinite recursion detected") on every insert/select.
--
-- Solution: route the cross-table existence checks through SECURITY DEFINER
-- helpers so the inner lookup runs without triggering the other table's RLS.

create or replace function public.is_buddy_read_participant(br_id uuid, uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from buddy_read_participants
    where buddy_read_id = br_id and user_id = uid
  );
$$;

create or replace function public.is_buddy_read_owner(br_id uuid, uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from buddy_reads where id = br_id and owner_id = uid
  );
$$;

grant execute on function public.is_buddy_read_participant(uuid, uuid) to authenticated, anon;
grant execute on function public.is_buddy_read_owner(uuid, uuid)       to authenticated, anon;


-- buddy_reads SELECT — replace direct EXISTS with helper
drop policy if exists "Owner or participant or public sees buddy_reads" on buddy_reads;
create policy "Owner or participant or public sees buddy_reads"
  on buddy_reads for select
  using (
    is_public = true
    or owner_id = auth.uid()
    or public.is_buddy_read_participant(id, auth.uid())
  );

-- buddy_read_participants SELECT — replace direct EXISTS with helper
drop policy if exists "Participants see participant rows" on buddy_read_participants;
create policy "Participants see participant rows"
  on buddy_read_participants for select
  using (
    public.is_buddy_read_owner(buddy_read_id, auth.uid())
    or user_id = auth.uid()
    or public.is_buddy_read_participant(buddy_read_id, auth.uid())
  );

-- buddy_read_participants INSERT — also uses cross-table EXISTS, route through helper
drop policy if exists "Owner manages participant rows" on buddy_read_participants;
create policy "Owner manages participant rows"
  on buddy_read_participants for insert
  to authenticated
  with check (
    public.is_buddy_read_owner(buddy_read_id, auth.uid())
    or user_id = auth.uid()
  );

-- buddy_read_participants UPDATE — same treatment
drop policy if exists "User updates own participant row" on buddy_read_participants;
create policy "User updates own participant row"
  on buddy_read_participants for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_buddy_read_owner(buddy_read_id, auth.uid())
  );

-- buddy_read_participants DELETE — same treatment
drop policy if exists "User can leave (delete own row)" on buddy_read_participants;
create policy "User can leave (delete own row)"
  on buddy_read_participants for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_buddy_read_owner(buddy_read_id, auth.uid())
  );

-- buddy_read_messages SELECT — same pattern (references buddy_reads + participants)
drop policy if exists "Participants see messages" on buddy_read_messages;
create policy "Participants see messages"
  on buddy_read_messages for select
  using (
    public.is_buddy_read_owner(buddy_read_id, auth.uid())
    or public.is_buddy_read_participant(buddy_read_id, auth.uid())
  );

-- buddy_read_messages INSERT
drop policy if exists "Participants insert messages" on buddy_read_messages;
create policy "Participants insert messages"
  on buddy_read_messages for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      public.is_buddy_read_owner(buddy_read_id, auth.uid())
      or public.is_buddy_read_participant(buddy_read_id, auth.uid())
    )
  );

notify pgrst, 'reload schema';
