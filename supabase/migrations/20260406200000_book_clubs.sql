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

-- ─── Helper functions (security definer breaks the RLS recursion cycle) ────────
-- These query book_club_members bypassing RLS, so policies on book_clubs
-- can safely call them without triggering book_club_members RLS → book_clubs
-- RLS → infinite loop.

create or replace function is_club_member(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from book_club_members
    where club_id = p_club_id and user_id = p_user_id
  );
$$;

create or replace function is_club_admin(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from book_club_members
    where club_id = p_club_id and user_id = p_user_id and role = 'admin'
  );
$$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table book_clubs        enable row level security;
alter table book_club_members enable row level security;
alter table book_club_posts   enable row level security;

-- book_clubs: public clubs visible to all; private clubs only to members
-- Uses is_club_member() (security definer) to avoid recursion.
create policy "View public clubs"
  on book_clubs for select
  using (is_public = true or is_club_member(id, auth.uid()));

create policy "Authenticated users can create clubs"
  on book_clubs for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "Admins can update their clubs"
  on book_clubs for update
  to authenticated
  using (is_club_admin(id, auth.uid()));

create policy "Admins can delete their clubs"
  on book_clubs for delete
  to authenticated
  using (is_club_admin(id, auth.uid()));

-- book_club_members: authenticated users can read all membership rows.
-- Membership is not sensitive (who's in a public book club), and keeping
-- this policy simple is what breaks the recursion — no cross-reference back
-- to book_clubs here.
create policy "Authenticated users can view memberships"
  on book_club_members for select
  to authenticated
  using (true);

create policy "Users can join public clubs or be invited"
  on book_club_members for insert
  to authenticated
  with check (
    -- joining yourself to a public club
    (user_id = auth.uid() and exists (
      select 1 from book_clubs c where c.id = club_id and c.is_public = true
    ))
    -- an admin is adding someone
    or is_club_admin(club_id, auth.uid())
    -- creator adding themselves as first member
    or exists (
      select 1 from book_clubs c where c.id = club_id and c.created_by = auth.uid()
    )
  );

create policy "Members can leave clubs"
  on book_club_members for delete
  to authenticated
  using (user_id = auth.uid());

-- book_club_posts: members can read and post; uses is_club_member() to avoid recursion
create policy "Members can view posts"
  on book_club_posts for select
  using (is_club_member(club_id, auth.uid()));

create policy "Members can post"
  on book_club_posts for insert
  to authenticated
  with check (user_id = auth.uid() and is_club_member(club_id, auth.uid()));

create policy "Users can delete their own posts"
  on book_club_posts for delete
  to authenticated
  using (user_id = auth.uid());

-- ─── indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_book_club_members_user    on book_club_members(user_id);
create index if not exists idx_book_club_members_club    on book_club_members(club_id);
create index if not exists idx_book_club_posts_club      on book_club_posts(club_id);
create index if not exists idx_book_club_posts_created   on book_club_posts(created_at);
