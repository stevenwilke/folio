-- Public book detail pages.
--
-- The web app now exposes `/book/:id` as a public route so share links work
-- for visitors without a session. The existing tables the page reads already
-- allow anon SELECT (books, valuations, book_ratings, book_quotes) — this
-- migration makes that access explicit (idempotent) and adds a dedicated
-- `public_reviews` view so we don't have to open the whole
-- `collection_entries` table to anon just to render the Reviews tab.

-- ── Anon SELECT policies (explicit; no-op if already effectively open) ──

drop policy if exists "Anon can read books" on books;
create policy "Anon can read books"
  on books for select to anon
  using (true);

drop policy if exists "Anon can read valuations" on valuations;
create policy "Anon can read valuations"
  on valuations for select to anon
  using (true);

drop policy if exists "Anon can read book_quotes" on book_quotes;
create policy "Anon can read book_quotes"
  on book_quotes for select to anon
  using (true);

-- profiles: anon only sees the public-facing columns used in review/quote
-- attribution. Column-level grants keep email and other private fields hidden.
grant select (id, username, avatar_url) on profiles to anon;

-- ── Public reviews view ────────────────────────────────────────────────
-- Exposes only rows with a non-null review_text + the public profile of the
-- reviewer. Anon can SELECT this view; the underlying `collection_entries`
-- table stays locked to `authenticated` users' own rows.

create or replace view public_reviews as
  select
    ce.id,
    ce.book_id,
    ce.user_rating,
    ce.review_text,
    ce.added_at,
    p.username,
    p.avatar_url
  from collection_entries ce
  join profiles p on p.id = ce.user_id
  where ce.review_text is not null;

-- Views execute with the querying user's rights by default, but their
-- underlying RLS applies. Since collection_entries is RLS-locked, the anon
-- client can't see the view's rows through it. `security_invoker = false`
-- (security definer) lets us publish it as a curated public dataset.
alter view public_reviews set (security_invoker = false);

grant select on public_reviews to anon, authenticated;
