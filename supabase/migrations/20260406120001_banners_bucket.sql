-- Create public banners storage bucket for profile banner images
insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload their own banner
drop policy if exists "Users can upload their own banner" on storage.objects;
create policy "Users can upload their own banner"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'banners' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow authenticated users to update/replace their own banner
drop policy if exists "Users can update their own banner" on storage.objects;
create policy "Users can update their own banner"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'banners' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow authenticated users to delete their own banner
drop policy if exists "Users can delete their own banner" on storage.objects;
create policy "Users can delete their own banner"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'banners' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow anyone to view banners (public profiles)
drop policy if exists "Anyone can view banners" on storage.objects;
create policy "Anyone can view banners"
  on storage.objects for select
  using (bucket_id = 'banners');
