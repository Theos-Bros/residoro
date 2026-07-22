-- ============================================================================
-- Migration: Training Session Tracking
-- Implements: tb-client-lifecycle-training-001 (theos-registry)
--
-- Reuses tb-client-lifecycle-contract-expiry-001's architecture as-is: a
-- pg_cron daily job calls a Supabase Edge Function
-- (supabase/functions/training-reminder-check) that owns the reminder-email
-- logic in TypeScript, same "SQL stays a thin dispatcher" reasoning as that
-- migration's header comment. No new Vault secret is bootstrapped here --
-- Supabase Edge Function secrets (CRON_SECRET, RESEND_API_KEY,
-- RESEND_FROM_EMAIL) are project-wide, not per-function, so the same values
-- already set for contract-expiry-check are available to this new function
-- automatically once deployed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Training sessions -- two per enrolled workspace
-- ----------------------------------------------------------------------------
create table if not exists public.training_sessions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  session_number  smallint not null check (session_number in (1, 2)),
  scheduled_date  date not null,
  status          text not null default 'scheduled' check (status in ('scheduled', 'completed', 'missed')),
  completed_at    timestamptz,
  reminder_sent_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (workspace_id, session_number)
);

comment on table public.training_sessions is
  'The two contractual training sessions per enrolled client (tb-client-lifecycle-training-001), '
  'one row per session_number (1 or 2). Written via POST/PATCH /admin/... backend routes only.';
comment on column public.training_sessions.reminder_sent_at is
  'Idempotency flag: the 3-day-ahead reminder email fires at most once per session, set by the '
  'training-reminder-check Edge Function. Reset to null whenever the operator reschedules the '
  'session date, mirroring contract_expiry''s warning_*_sent_at pattern.';

create index if not exists idx_training_sessions_workspace on public.training_sessions (workspace_id);

alter table public.training_sessions enable row level security;

grant all on public.training_sessions to service_role;

-- ----------------------------------------------------------------------------
-- 2. Daily cron trigger -> Edge Function (reminder, 3 days before each
--    scheduled_date -- confirmed with the user 2026-07-22, a single-tier
--    reminder, not contract-expiry's 30/7/1 multi-tier schedule)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'training-reminder-daily-check') then
    perform cron.unschedule('training-reminder-daily-check');
  end if;
end $$;

select cron.schedule(
  'training-reminder-daily-check',
  '0 1 * * *', -- 01:00 UTC daily, same slot as contract-expiry-daily-check
  $$
  select net.http_post(
    url := 'https://skfnrcwqvmurnpwrmixj.supabase.co/functions/v1/training-reminder-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'contract_expiry_cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
