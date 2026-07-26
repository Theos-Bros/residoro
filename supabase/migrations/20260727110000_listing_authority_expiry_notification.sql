-- ============================================================================
-- Migration: Listing Authority-Expiry Email Notification (7-day warning)
-- Implements: tb-listings-authority-expiry-notification-001 (theos-registry)
--
-- Same architecture as contract_expiry (20260722120000_contract_expiry.sql):
-- pg_cron fires a daily HTTP call via pg_net to a Supabase Edge Function
-- (supabase/functions/listing-authority-expiry-check) that owns all the
-- warning/email logic in TypeScript. SQL here stays a thin dispatcher.
--
-- Unlike contract_expiry, this reuses the *existing* project-wide CRON_SECRET
-- (confirmed live via `supabase secrets list` 2026-07-27 -- it's already an
-- Edge Function secret available to every function in this project, not
-- scoped per-function) and the existing Vault secret
-- 'contract_expiry_cron_secret' that already decrypts to that same value.
-- No new secret bootstrap step needed for this tracer bullet.
-- ============================================================================

-- pg_cron / pg_net already enabled by 20260722120000_contract_expiry.sql;
-- idempotent re-declaration in case this migration ever runs against a fresh
-- database ahead of that one.
create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.listings
  add column if not exists authority_warning_7d_sent_at timestamptz;

comment on column public.listings.authority_warning_7d_sent_at is
  'Idempotency flag (tb-listings-authority-expiry-notification-001): the 7-day authority-'
  'expiry warning email fires at most once per listing per approach. Reset to null by the '
  'listing-authority-expiry-check Edge Function if authority_expires_at is pushed back out '
  'past 7 days again (renewal case), so a future approach re-warns.';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'listing-authority-expiry-daily-check') then
    perform cron.unschedule('listing-authority-expiry-daily-check');
  end if;
end $$;

select cron.schedule(
  'listing-authority-expiry-daily-check',
  '0 2 * * *', -- 02:00 UTC daily, offset from contract-expiry's 01:00
  $$
  select net.http_post(
    url := 'https://skfnrcwqvmurnpwrmixj.supabase.co/functions/v1/listing-authority-expiry-check',
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
