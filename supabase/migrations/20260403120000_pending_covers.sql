-- pending_covers: stores user-submitted cover images awaiting admin review
create table if not exists pending_covers (
  id             uuid        primary key default gen_random_uuid(),
  book_id        uuid        not null references books(id) on delete cascade,
  user_id        uuid        not null references profiles(id) on delete cascade,
  storage_path   text        not null,
  review_token   text        not null unique default gen_random_uuid()::text,
  status         text        not null default 'pending'
                             check (status in ('pending', 'approved', 'rejected')),
  submitted_at   timestamptz not null default now(),
  reviewed_at    timestamptz
);

-- Only one pending submission per book at a time
create unique index if not exists pending_covers_one_pending_per_book
  on pending_covers(book_id)
  where status = 'pending';

-- RLS
alter table pending_covers enable row level security;

drop policy if exists "Users can submit covers" on pending_covers;
create policy "Users can submit covers"
  on pending_covers for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can view own submissions" on pending_covers;
create policy "Users can view own submissions"
  on pending_covers for select
  using (auth.uid() = user_id);

-- Storage bucket for book covers (public read, 2 MB limit, images only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'book-covers',
  'book-covers',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Storage policies
drop policy if exists "Public read book covers" on storage.objects;
create policy "Public read book covers"
  on storage.objects for select
  using (bucket_id = 'book-covers');

drop policy if exists "Authenticated users can upload book covers" on storage.objects;
create policy "Authenticated users can upload book covers"
  on storage.objects for insert
  with check (
    bucket_id = 'book-covers'
    and auth.role() = 'authenticated'
  );

-- Users can delete their own uploads (path starts with their user id)
drop policy if exists "Users can delete own book cover uploads" on storage.objects;
create policy "Users can delete own book cover uploads"
  on storage.objects for delete
  using (
    bucket_id = 'book-covers'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
