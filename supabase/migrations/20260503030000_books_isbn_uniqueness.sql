-- Prevent duplicate book rows on concurrent imports.
--
-- Goodreads import does check-then-insert per row; two parallel batches can
-- both check ISBN, both miss, both insert. Result: duplicate `books` rows
-- with the same ISBN that pollute the global library.
--
-- Partial unique indexes (only on rows with an ISBN — many books have none)
-- enforce uniqueness at the DB layer; the client now handles the race by
-- catching 23505 and re-querying.
--
-- IMPORTANT: this migration will fail loudly if existing duplicate ISBNs are
-- present. The pre-check below lists them so you can dedupe manually before
-- re-running. Auto-merging is intentionally not done here because it would
-- require re-pointing every FK (collection_entries, listings, orders,
-- reading_sessions, post quotes, drops, recommendations…) and that's worth
-- a careful manual pass.

do $check$
declare
  v_dupes int;
  v_sample text;
begin
  select count(*) into v_dupes from (
    select isbn_13 from books where isbn_13 is not null
    group by isbn_13 having count(*) > 1
  ) t;
  if v_dupes > 0 then
    select string_agg(isbn_13 || ' (' || cnt || ')', ', ') into v_sample from (
      select isbn_13, count(*) cnt from books where isbn_13 is not null
      group by isbn_13 having count(*) > 1 limit 10
    ) t;
    raise exception 'Cannot add unique index on books.isbn_13: % duplicate ISBN-13s found. First few: %. Dedupe in books table first (point referencing rows at canonical id, then delete dupes), then re-run.', v_dupes, v_sample;
  end if;

  select count(*) into v_dupes from (
    select isbn_10 from books where isbn_10 is not null
    group by isbn_10 having count(*) > 1
  ) t;
  if v_dupes > 0 then
    select string_agg(isbn_10 || ' (' || cnt || ')', ', ') into v_sample from (
      select isbn_10, count(*) cnt from books where isbn_10 is not null
      group by isbn_10 having count(*) > 1 limit 10
    ) t;
    raise exception 'Cannot add unique index on books.isbn_10: % duplicate ISBN-10s found. First few: %. Dedupe in books table first, then re-run.', v_dupes, v_sample;
  end if;
end $check$;

create unique index if not exists ux_books_isbn_13
  on books (isbn_13) where isbn_13 is not null;

create unique index if not exists ux_books_isbn_10
  on books (isbn_10) where isbn_10 is not null;
