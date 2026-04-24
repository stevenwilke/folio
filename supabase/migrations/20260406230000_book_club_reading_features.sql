-- ─── Due date on current book ────────────────────────────────────────────────
alter table book_clubs add column if not exists current_book_due_date date;

-- ─── Reading history ─────────────────────────────────────────────────────────
create table if not exists book_club_history (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references book_clubs(id) on delete cascade,
  book_id     uuid not null references books(id) on delete cascade,
  finished_at date not null default current_date,
  created_at  timestamptz not null default now(),
  unique(club_id, book_id)
);

-- ─── Nominations ─────────────────────────────────────────────────────────────
create table if not exists book_club_nominations (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references book_clubs(id) on delete cascade,
  book_id      uuid not null references books(id) on delete cascade,
  nominated_by uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique(club_id, book_id)
);
-- FK to profiles so PostgREST can join profiles(username)
alter table book_club_nominations
  add constraint if not exists book_club_nominations_profiles_fkey
  foreign key (nominated_by) references profiles(id) on delete cascade;

-- ─── Votes ───────────────────────────────────────────────────────────────────
create table if not exists book_club_votes (
  id            uuid primary key default gen_random_uuid(),
  nomination_id uuid not null references book_club_nominations(id) on delete cascade,
  club_id       uuid not null references book_clubs(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique(nomination_id, user_id)
);
-- FK to profiles so PostgREST can join profiles(username)
alter table book_club_votes
  add constraint if not exists book_club_votes_profiles_fkey
  foreign key (user_id) references profiles(id) on delete cascade;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table book_club_history     enable row level security;
alter table book_club_nominations enable row level security;
alter table book_club_votes       enable row level security;

-- history: members read; admins write
drop policy if exists "Members view history" on book_club_history;
create policy "Members view history"
  on book_club_history for select to authenticated
  using (is_club_member(club_id, auth.uid()));
drop policy if exists "Admins add to history" on book_club_history;
create policy "Admins add to history"
  on book_club_history for insert to authenticated
  with check (is_club_admin(club_id, auth.uid()));
drop policy if exists "Admins delete from history" on book_club_history;
create policy "Admins delete from history"
  on book_club_history for delete to authenticated
  using (is_club_admin(club_id, auth.uid()));

-- nominations: members read and nominate
drop policy if exists "Members view nominations" on book_club_nominations;
create policy "Members view nominations"
  on book_club_nominations for select to authenticated
  using (is_club_member(club_id, auth.uid()));
drop policy if exists "Members can nominate" on book_club_nominations;
create policy "Members can nominate"
  on book_club_nominations for insert to authenticated
  with check (nominated_by = auth.uid() and is_club_member(club_id, auth.uid()));
drop policy if exists "Remove own nomination or admin" on book_club_nominations;
create policy "Remove own nomination or admin"
  on book_club_nominations for delete to authenticated
  using (nominated_by = auth.uid() or is_club_admin(club_id, auth.uid()));

-- votes: members read and vote
drop policy if exists "Members view votes" on book_club_votes;
create policy "Members view votes"
  on book_club_votes for select to authenticated
  using (is_club_member(club_id, auth.uid()));
drop policy if exists "Members can vote" on book_club_votes;
create policy "Members can vote"
  on book_club_votes for insert to authenticated
  with check (user_id = auth.uid() and is_club_member(club_id, auth.uid()));
drop policy if exists "Members can unvote" on book_club_votes;
create policy "Members can unvote"
  on book_club_votes for delete to authenticated
  using (user_id = auth.uid());

-- ─── Indexes ─────────────────────────────────────────────────────────────────
create index if not exists idx_book_club_history_club     on book_club_history(club_id);
create index if not exists idx_book_club_nominations_club on book_club_nominations(club_id);
create index if not exists idx_book_club_votes_nom        on book_club_votes(nomination_id);

notify pgrst, 'reload schema';
