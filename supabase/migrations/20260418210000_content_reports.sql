-- User reports of objectionable content. Required for App Store UGC policy.
-- Admins review pending reports and take action (dismiss / delete content / ban user)
-- within 24 hours per Apple's guidelines.
create table if not exists content_reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid not null references profiles(id) on delete cascade,
  reported_user_id uuid references profiles(id) on delete set null,
  content_type    text not null,  -- 'review' | 'feed_post' | 'post_comment' | 'club_post' | 'book_recommendation' | 'profile' | 'poll' | 'poll_comment'
  content_id      uuid not null,  -- row id in the relevant table; for 'profile' this is the reported user's profile id
  reason          text not null,  -- 'spam' | 'harassment' | 'hate' | 'sexual' | 'violence' | 'self_harm' | 'illegal' | 'other'
  details         text,
  status          text not null default 'pending' check (status in ('pending', 'dismissed', 'actioned')),
  action_taken    text,  -- 'none' | 'content_deleted' | 'user_banned' | 'user_deleted'
  reviewed_by     uuid references profiles(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists content_reports_status_idx on content_reports(status, created_at desc);
create index if not exists content_reports_reporter_idx on content_reports(reporter_id);
create index if not exists content_reports_reported_user_idx on content_reports(reported_user_id);

alter table content_reports enable row level security;

-- Users can create reports and see their own.
drop policy if exists content_reports_insert_own on content_reports;
create policy content_reports_insert_own on content_reports
  for insert with check (auth.uid() = reporter_id);

drop policy if exists content_reports_select_own on content_reports;
create policy content_reports_select_own on content_reports
  for select using (auth.uid() = reporter_id);

-- Admins can see and update all reports.
drop policy if exists content_reports_select_admin on content_reports;
create policy content_reports_select_admin on content_reports
  for select using (
    exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  );

drop policy if exists content_reports_update_admin on content_reports;
create policy content_reports_update_admin on content_reports
  for update using (
    exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  );
