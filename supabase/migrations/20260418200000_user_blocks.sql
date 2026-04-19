-- Per-user block list. Required for App Store UGC policy.
-- A block hides the blocked user's content from the blocker and prevents the
-- blocked user from seeing the blocker's content or initiating contact.
create table if not exists user_blocks (
  id              uuid primary key default gen_random_uuid(),
  blocker_id      uuid not null references profiles(id) on delete cascade,
  blocked_id      uuid not null references profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique(blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocker_idx on user_blocks(blocker_id);
create index if not exists user_blocks_blocked_idx on user_blocks(blocked_id);

alter table user_blocks enable row level security;

-- You can see your own blocks and create/delete them.
create policy user_blocks_select_own on user_blocks
  for select using (auth.uid() = blocker_id);

create policy user_blocks_insert_own on user_blocks
  for insert with check (auth.uid() = blocker_id);

create policy user_blocks_delete_own on user_blocks
  for delete using (auth.uid() = blocker_id);

-- Admins can see all blocks (for moderation context).
create policy user_blocks_select_admin on user_blocks
  for select using (
    exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  );
