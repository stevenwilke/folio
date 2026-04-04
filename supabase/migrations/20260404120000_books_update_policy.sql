-- Allow authenticated users to update book metadata (cover, description, genre, ISBNs)
-- Books are shared records; enrichment runs client-side for the benefit of all users.
create policy "Authenticated users can update book metadata"
  on books for update
  using  (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
