-- Server-side level / XP computation.
--
-- Levels were previously computed client-side from the user's earned
-- badges, with the result written to profiles only when the user visited
-- the Stats page. Result: users who never visit Stats stay at level 1
-- forever, and racing tabs clobber each other.
--
-- Fix: a `badges` reference table holds the canonical badge_id → tier
-- mapping (mirrors src/lib/badges.js). A trigger on badge_unlocks
-- recomputes the user's level + level_points after every insert/delete
-- so the values stay correct without any client involvement.

-- ── 1. Badges reference table ───────────────────────────────────────────────
create table if not exists badges (
  badge_id text primary key,
  tier     text not null check (tier in ('bronze','silver','gold','platinum','legendary'))
);

-- Seed with the 43 existing badge_ids (mirrors src/lib/badges.js as of
-- 2026-05-02). When a new badge is added in JS, also insert a row here.
-- Idempotent via on conflict do update.
insert into badges (badge_id, tier) values
  ('first_read',        'bronze'),
  ('bookworm',          'bronze'),
  ('devoted',           'silver'),
  ('century',           'gold'),
  ('legendary',         'platinum'),
  ('mythic_reader',     'legendary'),
  ('page_turner',       'bronze'),
  ('marathon',          'silver'),
  ('page_legend',       'gold'),
  ('page_cosmonaut',    'platinum'),
  ('page_galaxy',       'legendary'),
  ('deep_diver',        'bronze'),
  ('tome_tamer',        'silver'),
  ('epic_reader',       'gold'),
  ('behemoth_tamer',    'platinum'),
  ('titan_reader',      'legendary'),
  ('genre_curious',     'bronze'),
  ('explorer',          'silver'),
  ('omnivore',          'gold'),
  ('genre_polymath',    'platinum'),
  ('boundless_reader',  'legendary'),
  ('opinionated',       'bronze'),
  ('critic',            'silver'),
  ('chief_critic',      'gold'),
  ('prolific_critic',   'platinum'),
  ('voice_of_letters',  'legendary'),
  ('well_read',         'silver'),
  ('collector',         'silver'),
  ('completionist',     'silver'),
  ('bibliophile',       'gold'),
  ('library_lord',      'platinum'),
  ('sage_of_stacks',    'legendary'),
  ('connected',         'bronze'),
  ('social',            'silver'),
  ('connector',         'gold'),
  ('reading_circle',    'platinum'),
  ('club_royalty',      'legendary'),
  ('series_starter',    'bronze'),
  ('series_devotee',    'silver'),
  ('series_master',     'gold'),
  ('saga_devotee',      'platinum'),
  ('series_legend',     'legendary'),
  ('monthly_habit',     'bronze')
on conflict (badge_id) do update set tier = excluded.tier;

-- Public-readable; writes are admin-only via service role.
alter table badges enable row level security;
drop policy if exists badges_public_read on badges;
do $do$
begin
  create policy badges_public_read on badges for select using (true);
exception when duplicate_object then null;
end $do$;

-- ── 2. Recompute helper + trigger ───────────────────────────────────────────
-- Clean up orphan helper functions from earlier drafts of this migration
-- (now inlined into recompute_user_level below).
drop function if exists tier_points(text);
drop function if exists level_for_points(int);

-- Tier points and level thresholds are inlined as CASE expressions inside
-- this single plpgsql function (rather than helper SQL functions) because
-- the Supabase dashboard SQL editor's statement splitter chokes on bare
-- `case ... end` inside SQL-language function bodies.
--
-- Mirrors src/lib/level.js exactly:
--   TIER_POINTS    = { bronze:1, silver:3, gold:5, platinum:10 }
--                    (legendary awards 0, matching current client behavior)
--   LEVEL_THRESHOLDS = [0, 5, 15, 30, 50, 75, 100, 130, 170, 220], cap at 10
create or replace function recompute_user_level(p_user_id uuid)
returns void language plpgsql security definer set search_path = public
as $recompute_user_level$
declare
  v_points int;
  v_level  int;
begin
  select coalesce(sum(case b.tier
    when 'bronze'   then 1
    when 'silver'   then 3
    when 'gold'     then 5
    when 'platinum' then 10
    else 0
  end), 0)
    into v_points
    from badge_unlocks bu
    join badges b on b.badge_id = bu.badge_id
    where bu.user_id = p_user_id;

  v_level := case
    when v_points >= 220 then 10
    when v_points >= 170 then 9
    when v_points >= 130 then 8
    when v_points >= 100 then 7
    when v_points >= 75  then 6
    when v_points >= 50  then 5
    when v_points >= 30  then 4
    when v_points >= 15  then 3
    when v_points >= 5   then 2
    else 1
  end;

  update profiles
    set level = v_level, level_points = v_points
    where id = p_user_id
      and (level is distinct from v_level or level_points is distinct from v_points);
end
$recompute_user_level$;

create or replace function trg_badge_unlocks_recompute()
returns trigger language plpgsql security definer set search_path = public
as $trg_badge_unlocks_recompute$
begin
  -- AFTER INSERT/DELETE: TG_OP tells which; the user_id is in NEW or OLD.
  perform recompute_user_level(coalesce(new.user_id, old.user_id));
  return null;  -- AFTER trigger return value is ignored
end
$trg_badge_unlocks_recompute$;

drop trigger if exists trg_badge_unlocks_level on badge_unlocks;
create trigger trg_badge_unlocks_level
  after insert or delete on badge_unlocks
  for each row execute function trg_badge_unlocks_recompute();

-- ── 4. Backfill: recompute everyone once so existing users sync up ──────────
do $backfill$
declare r record;
begin
  for r in select distinct user_id from badge_unlocks loop
    perform recompute_user_level(r.user_id);
  end loop;
end
$backfill$;
