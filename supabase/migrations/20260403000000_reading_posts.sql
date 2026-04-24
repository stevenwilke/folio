-- ── Reading Posts (social feed) ──────────────────────────────────────────────
create table if not exists reading_posts (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users(id) on delete cascade not null,
  book_id     uuid        references books(id) on delete set null,
  content     text,
  image_url   text,
  created_at  timestamptz default now() not null,
  constraint  content_or_image check (content is not null or image_url is not null)
);

-- ── Post Likes ────────────────────────────────────────────────────────────────
create table if not exists post_likes (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users(id) on delete cascade not null,
  post_id     uuid        references reading_posts(id) on delete cascade not null,
  created_at  timestamptz default now() not null,
  unique (user_id, post_id)
);

-- ── Post Comments ─────────────────────────────────────────────────────────────
create table if not exists post_comments (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users(id) on delete cascade not null,
  post_id     uuid        references reading_posts(id) on delete cascade not null,
  content     text        not null,
  created_at  timestamptz default now() not null
);

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table reading_posts  enable row level security;
alter table post_likes     enable row level security;
alter table post_comments  enable row level security;

-- reading_posts policies
drop policy if exists "Anyone can read posts" on reading_posts;
create policy "Anyone can read posts"
  on reading_posts for select using (true);
drop policy if exists "Users insert own posts" on reading_posts;
create policy "Users insert own posts"
  on reading_posts for insert with check (auth.uid() = user_id);
drop policy if exists "Users delete own posts" on reading_posts;
create policy "Users delete own posts"
  on reading_posts for delete using (auth.uid() = user_id);
drop policy if exists "Users update own posts" on reading_posts;
create policy "Users update own posts"
  on reading_posts for update using (auth.uid() = user_id);

-- post_likes policies
drop policy if exists "Anyone can read likes" on post_likes;
create policy "Anyone can read likes"
  on post_likes for select using (true);
drop policy if exists "Users insert own likes" on post_likes;
create policy "Users insert own likes"
  on post_likes for insert with check (auth.uid() = user_id);
drop policy if exists "Users delete own likes" on post_likes;
create policy "Users delete own likes"
  on post_likes for delete using (auth.uid() = user_id);

-- post_comments policies
drop policy if exists "Anyone can read comments" on post_comments;
create policy "Anyone can read comments"
  on post_comments for select using (true);
drop policy if exists "Users insert own comments" on post_comments;
create policy "Users insert own comments"
  on post_comments for insert with check (auth.uid() = user_id);
drop policy if exists "Users delete own comments" on post_comments;
create policy "Users delete own comments"
  on post_comments for delete using (auth.uid() = user_id);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists reading_posts_created_at_idx on reading_posts (created_at desc);
create index if not exists reading_posts_user_id_idx    on reading_posts (user_id);
create index if not exists reading_posts_book_id_idx    on reading_posts (book_id);
create index if not exists post_likes_post_id_idx       on post_likes (post_id);
create index if not exists post_comments_post_id_idx    on post_comments (post_id);

-- ── Post-images storage bucket ────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

drop policy if exists "Anyone can read post images" on storage.objects;
create policy "Anyone can read post images"
  on storage.objects for select
  using (bucket_id = 'post-images');

drop policy if exists "Authenticated users can upload post images" on storage.objects;
create policy "Authenticated users can upload post images"
  on storage.objects for insert
  with check (bucket_id = 'post-images' and auth.role() = 'authenticated');

drop policy if exists "Users can delete own post images" on storage.objects;
create policy "Users can delete own post images"
  on storage.objects for delete
  using (bucket_id = 'post-images' and auth.uid()::text = (storage.foldername(name))[1]);
