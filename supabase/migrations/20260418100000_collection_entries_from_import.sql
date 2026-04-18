-- Flags a collection entry as created via bulk import (e.g. Goodreads).
-- Imported entries don't have a real "finished reading" date — their updated_at
-- reflects the import timestamp, not when the book was actually read. Year-based
-- stats exclude these to avoid lumping an entire import into the current year.
alter table collection_entries
  add column if not exists from_import boolean not null default false;
