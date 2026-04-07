-- ─── Admin flag on profiles ──────────────────────────────────────────────────
alter table profiles add column if not exists is_admin boolean not null default false;

-- ─── Authors ─────────────────────────────────────────────────────────────────
create table if not exists authors (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  bio          text,
  photo_url    text,
  website      text,
  claimed_by   uuid references auth.users(id) on delete set null,
  is_verified  boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ─── Author follows ───────────────────────────────────────────────────────────
create table if not exists author_follows (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  author_id   uuid not null references authors(id) on delete cascade,
  is_favorite boolean not null default false,
  created_at  timestamptz not null default now(),
  unique(user_id, author_id)
);

-- ─── Author posts ─────────────────────────────────────────────────────────────
create table if not exists author_posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references authors(id) on delete cascade,
  type       text not null default 'update'
               check (type in ('update', 'giveaway', 'announcement', 'new_book')),
  title      text,
  content    text not null,
  link_url   text,
  created_at timestamptz not null default now()
);

-- ─── Author claims ────────────────────────────────────────────────────────────
create table if not exists author_claims (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references authors(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  message    text,
  proof_url  text,
  status     text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  unique(author_id, user_id)
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table authors        enable row level security;
alter table author_follows enable row level security;
alter table author_posts   enable row level security;
alter table author_claims  enable row level security;

-- authors: public read; verified author (claimed_by) or admin can update
create policy "Anyone can view authors"
  on authors for select using (true);

create policy "Authenticated can insert authors"
  on authors for insert to authenticated
  with check (true);

create policy "Verified author or admin can update"
  on authors for update to authenticated
  using (
    claimed_by = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  );

-- author_follows: users manage their own rows; anyone authenticated can read
create policy "Authenticated can view follows"
  on author_follows for select to authenticated using (true);

create policy "Users manage own follows"
  on author_follows for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users update own follows"
  on author_follows for update to authenticated
  using (user_id = auth.uid());

create policy "Users delete own follows"
  on author_follows for delete to authenticated
  using (user_id = auth.uid());

-- author_posts: public read; only the claimed (verified) author can post
create policy "Anyone can view author posts"
  on author_posts for select using (true);

create policy "Verified author can post"
  on author_posts for insert to authenticated
  with check (
    exists (
      select 1 from authors
      where id = author_id and claimed_by = auth.uid() and is_verified = true
    )
  );

create policy "Verified author can delete own posts"
  on author_posts for delete to authenticated
  using (
    exists (
      select 1 from authors
      where id = author_id and claimed_by = auth.uid() and is_verified = true
    )
  );

-- author_claims: users can see their own; admins see all; users can insert
create policy "Users view own claims"
  on author_claims for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  );

create policy "Users can submit claims"
  on author_claims for insert to authenticated
  with check (user_id = auth.uid());

create policy "Admins can update claim status"
  on author_claims for update to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

-- ─── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_authors_name         on authors(lower(name));
create index if not exists idx_author_follows_user  on author_follows(user_id);
create index if not exists idx_author_follows_auth  on author_follows(author_id);
create index if not exists idx_author_posts_author  on author_posts(author_id);
create index if not exists idx_author_claims_status on author_claims(status);

notify pgrst, 'reload schema';
