-- Add extra book metadata fields used by ManualAddModal
alter table books
  add column if not exists publisher    text,
  add column if not exists pages        integer,
  add column if not exists format       text,
  add column if not exists language     text default 'English',
  add column if not exists series_name  text,
  add column if not exists series_number text;
