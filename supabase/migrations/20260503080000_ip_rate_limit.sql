-- Per-IP rate-limit audit table for unauthenticated edge functions
-- (submit-contact, export-library). Mirrors the user-keyed edge_calls
-- table from migration 20260503070000.
--
-- IPs are recorded as text; old rows pruned on each call (24h retention).

create table if not exists ip_rate_limits (
  id        bigserial   primary key,
  ip        text        not null,
  fn_name   text        not null,
  called_at timestamptz not null default now()
);

create index if not exists idx_ip_rate_limits_ip_fn_recent
  on ip_rate_limits (ip, fn_name, called_at desc);

-- Service-role only (the Edge function helpers write/read here). No public
-- access — RLS is enabled and no policy is defined, which means the table
-- is invisible to anon/authenticated callers.
alter table ip_rate_limits enable row level security;
