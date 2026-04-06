-- ─── book_clubs ──────────────────────────────────────────────────────────────
create table if not exists book_clubs (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  created_by      uuid not null references auth.users(id) on delete cascade,
  is_public       boolean not null default true,
  current_book_id uuid references books(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- ─── book_club_members ────────────────────────────────────────────────────────
create table if not exists book_club_members (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references book_clubs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('admin', 'member')),
  joined_at  timestamptz not null default now(),
  unique (club_id, user_id)
);

-- ─── book_club_posts ──────────────────────────────────────────────────────────
create table if not exists book_club_posts (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references book_clubs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table book_clubs        enable row level security;
alter table book_club_members enable row level security;
alter table book_club_posts   enable row level security;

-- book_clubs: public clubs visible to all; private clubs visible only to members
create policy "View public clubs"
  on book_clubs for select
  using (
    is_public = true
    or exists (
      select 1 from book_club_members m
      where m.club_id = book_clubs.id and m.user_id = auth.uid()
    )
  );

create policy "Authenticated users can create clubs"
  on book_clubs for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "Admins can update their clubs"
  on book_clubs for update
  to authenticated
  using (
    exists (
      select 1 from book_club_members m
      where m.club_id = book_clubs.id and m.user_id = auth.uid() and m.role = 'admin'
    )
  );

create policy "Admins can delete their clubs"
  on book_clubs for delete
  to authenticated
  using (
    exists (
      select 1 from book_club_members m
      where m.club_id = book_clubs.id and m.user_id = auth.uid() and m.role = 'admin'
    )
  );

-- book_club_members: members can see other members
create policy "Members can view club membership"
  on book_club_members for select
  using (
    exists (
      select 1 from book_club_members m2
      where m2.club_id = book_club_members.club_id and m2.user_id = auth.uid()
    )
    or exists (
      select 1 from book_clubs c
      where c.id = book_club_members.club_id and c.is_public = true
    )
  );

create policy "Users can join public clubs or be invited"
  on book_club_members for insert
  to authenticated
  with check (
    -- joining yourself to a public club
    (user_id = auth.uid() and exists (
      select 1 from book_clubs c where c.id = club_id and c.is_public = true
    ))
    -- or an admin is adding someone
    or exists (
      select 1 from book_club_members m
      where m.club_id = book_club_members.club_id and m.user_id = auth.uid() and m.role = 'admin'
    )
    -- or you are the club creator (adding yourself as first member)
    or exists (
      select 1 from book_clubs c where c.id = club_id and c.created_by = auth.uid()
    )
  );

create policy "Members can leave clubs"
  on book_club_members for delete
  to authenticated
  using (user_id = auth.uid());

-- book_club_posts: members of the club can read and post
create policy "Members can view posts"
  on book_club_posts for select
  using (
    exists (
      select 1 from book_club_members m
      where m.club_id = book_club_posts.club_id and m.user_id = auth.uid()
    )
  );

create policy "Members can post"
  on book_club_posts for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from book_club_members m
      where m.club_id = book_club_posts.club_id and m.user_id = auth.uid()
    )
  );

create policy "Users can delete their own posts"
  on book_club_posts for delete
  to authenticated
  using (user_id = auth.uid());

-- ─── indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_book_club_members_user    on book_club_members(user_id);
create index if not exists idx_book_club_members_club    on book_club_members(club_id);
create index if not exists idx_book_club_posts_club      on book_club_posts(club_id);
create index if not exists idx_book_club_posts_created   on book_club_posts(created_at);
