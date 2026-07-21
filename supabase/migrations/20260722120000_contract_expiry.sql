-- ============================================================================
-- Migration: Contract Lifecycle Enforcement
-- Implements: tb-client-lifecycle-contract-expiry-001 (theos-registry)
--
-- Architecture decision (5-agent design review, 2026-07-22): pg_cron fires a
-- daily HTTP call via pg_net to a Supabase Edge Function
-- (supabase/functions/contract-expiry-check) that owns ALL the actual
-- state-transition/warning/email logic in TypeScript. SQL here stays a thin
-- dispatcher (schema + one cron.schedule call) rather than a second
-- SECURITY DEFINER plpgsql function -- handle_new_user() is already the
-- codebase's one precedent for "real logic in SQL" and its own migration
-- comment treats that as an uncomfortable exception, not a pattern to grow.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- 1. Workspace access state + per-threshold warning idempotency flags
-- ----------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists access_state text not null default 'active'
    check (access_state in ('active', 'read_only', 'blocked')),
  add column if not exists warning_30d_sent_at timestamptz,
  add column if not exists warning_7d_sent_at timestamptz,
  add column if not exists warning_1d_sent_at timestamptz;

comment on column public.workspaces.access_state is
  'Set by the contract-expiry-check Edge Function (tb-client-lifecycle-contract-expiry-001), '
  'never directly by the frontend or a normal backend route. active = normal; read_only = '
  'past contract_end_date, within the 7-day grace period (writes blocked, reads/export ok); '
  'blocked = grace period elapsed (login itself rejected). Enforced in '
  'application/backend/src/lib/auth.ts requireAuth.';
comment on column public.workspaces.warning_30d_sent_at is
  'Idempotency flag: the 30-day warning email/notification fires at most once per workspace '
  'per contract period. Cleared on renewal (contract_end_date pushed out past 30 days again).';

-- ----------------------------------------------------------------------------
-- 2. Side-panel notification records (persist until dismissed)
--    Same "RLS enabled, no policies, service-role-only" precedent as
--    migration_temp_files -- every access goes through the backend API.
-- ----------------------------------------------------------------------------
create table if not exists public.contract_notifications (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.workspaces(id) on delete cascade,
  threshold    text not null check (threshold in ('30d', '7d', '1d')),
  message      text not null,
  created_at   timestamptz not null default now(),
  dismissed_at timestamptz
);

comment on table public.contract_notifications is
  'Side-panel warning notifications (tb-client-lifecycle-contract-expiry-001), written by the '
  'contract-expiry-check Edge Function, read/dismissed via GET/POST /me/... backend routes.';

create index if not exists idx_contract_notifications_tenant
  on public.contract_notifications (tenant_id);
create index if not exists idx_contract_notifications_tenant_undismissed
  on public.contract_notifications (tenant_id) where dismissed_at is null;

alter table public.contract_notifications enable row level security;

grant all on public.contract_notifications to service_role;

-- ----------------------------------------------------------------------------
-- 3. Daily cron trigger -> Edge Function
--
--    The Authorization bearer value is read from Supabase Vault at call
--    time, never committed to this file. This is a bootstrap step you run
--    yourself (see the tracer bullet's setup notes) -- NOT part of this
--    migration, because a migration file is git history forever and this
--    secret must never appear in it:
--
--      select vault.create_secret('<openssl rand -hex 32 output>',
--        'contract_expiry_cron_secret');
--
--    Then set the SAME value as the Edge Function's secret:
--      supabase secrets set CRON_SECRET=<same value>
--
--    Until that secret exists, this cron job's calls will fail closed (null
--    bearer token -> the Edge Function's CRON_SECRET check rejects it) --
--    safe by default, not silently insecure if the bootstrap step is missed.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'contract-expiry-daily-check') then
    perform cron.unschedule('contract-expiry-daily-check');
  end if;
end $$;

select cron.schedule(
  'contract-expiry-daily-check',
  '0 1 * * *', -- 01:00 UTC daily
  $$
  select net.http_post(
    url := 'https://skfnrcwqvmurnpwrmixj.supabase.co/functions/v1/contract-expiry-check',
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
