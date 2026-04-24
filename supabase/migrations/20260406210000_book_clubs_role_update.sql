-- Allow admins to update member roles within their clubs
drop policy if exists "Admins can update member roles" on book_club_members;
create policy "Admins can update member roles"
  on book_club_members for update
  to authenticated
  using  (is_club_admin(club_id, auth.uid()))
  with check (is_club_admin(club_id, auth.uid()));
