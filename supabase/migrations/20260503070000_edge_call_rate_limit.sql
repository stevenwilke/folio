-- Generic per-user, per-function rate-limit audit table.
--
-- Used by the rateLimit() helper in supabase/functions/_shared/auth.ts.
-- Each Edge function call writes a row tagged with the function name; the
-- helper rejects callers who exceed the per-hour quota for that function.
-- Old rows are pruned opportunistically (24h retention).

create table if not exists edge_calls (
  id        uuid        primary key default gen_random_uuid(),
  user_id   uuid        not null references auth.users(id) on delete cascade,
  fn_name   text        not null,
  called_at timestamptz not null default now()
);

create index if not exists idx_edge_calls_user_fn_recent
  on edge_calls (user_id, fn_name, called_at desc);

alter table edge_calls enable row level security;

-- Users can read their own audit rows; only the SECURITY DEFINER service
-- role (used by Edge functions) writes.
drop policy if exists edge_calls_self_select on edge_calls;
do $do$
begin
  create policy edge_calls_self_select
    on edge_calls for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null;
end $do$;
