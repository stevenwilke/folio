# Scheduling stale-reading-check

This function is meant to run once per day. Pick one:

## Option A — pg_cron (preferred, runs inside Supabase)

Run in the SQL editor as a superuser-role user:

```sql
-- One-time: enable extensions if not already on
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Schedule: every day at 18:00 UTC (pick any hour you want)
select cron.schedule(
  'stale-reading-check-daily',
  '0 18 * * *',
  $$
  select net.http_post(
    url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/stale-reading-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    )
  );
  $$
);
```

Replace `<YOUR-PROJECT-REF>` and `<SERVICE_ROLE_KEY>`. To remove later:

```sql
select cron.unschedule('stale-reading-check-daily');
```

## Option B — GitHub Action / external cron

`curl -X POST https://<ref>.supabase.co/functions/v1/stale-reading-check -H "Authorization: Bearer <SERVICE_ROLE_KEY>"`

## Tuning

Open `index.ts` to change:

- `STALE_DAYS` — how quiet a book must be before we nudge (default 14)
- `COOLDOWN_DAYS` — minimum gap between reminders for the same book (default 7)
