-- ============================================================================
-- Migration: Notifications -- table, RLS, task due-date reminder cron
-- Implements: tb-notifications-task-due-reminder-001 (theos-registry), TB1
-- of cap-notifications-001
--
-- recipient_id is deliberately nullable (null = tenant-wide) and
-- entity_type/entity_id is a generic polymorphic link (no FK), matching
-- cap-tasks-001's own entity_type/entity_id precedent, so a future
-- notification-producing consumer never needs a schema change here.
-- Unlike contract_notifications' "RLS enabled, no policies, service-role-
-- only" shortcut (a documented exception per tb-platform-rls-scoped-client-
-- 001), this table uses real RLS policies against the scoped client -- the
-- current target architecture, not the older exception.
-- ============================================================================

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.workspaces(id),
  recipient_id uuid references public.profiles(id), -- nullable: null = tenant-wide

  type         text not null,
  entity_type  text,
  entity_id    uuid,

  title        text not null,
  message      text not null,

  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  dismissed_at timestamptz
);

comment on column public.notifications.recipient_id is
  'Nullable -- null means tenant-wide (not yet produced by any consumer as '
  'of this migration, but the read path supports it from day one per '
  'cap-notifications-001''s schema).';
comment on column public.notifications.entity_type is
  'Generic polymorphic link (e.g. ''task''), no FK by design -- same '
  'precedent as tasks.entity_type (cap-tasks-001 Decision #2).';

create index idx_notifications_tenant_recipient
  on public.notifications (tenant_id, recipient_id);
create index idx_notifications_tenant_undismissed
  on public.notifications (tenant_id, recipient_id) where dismissed_at is null;

alter table public.notifications enable row level security;

-- A tenant member sees their own notifications plus any tenant-wide ones,
-- within their own tenant only.
create policy notifications_select_own_or_tenant_wide on public.notifications
  for select using (
    tenant_id = (select public.current_tenant_id())
    and (recipient_id = (select auth.uid()) or recipient_id is null)
  );

-- Dismiss (the only client-facing write) is limited to a recipient's own
-- rows -- a tenant-wide notification can't be dismissed by one member for
-- everyone.
create policy notifications_update_own on public.notifications
  for update using (
    tenant_id = (select public.current_tenant_id())
    and recipient_id = (select auth.uid())
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and recipient_id = (select auth.uid())
  );

grant select, update on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- ----------------------------------------------------------------------------
-- tasks.reminder_sent_at -- idempotency flag, same precedent as
-- workspaces.warning_30d_sent_at / listings.authority_warning_7d_sent_at.
-- ----------------------------------------------------------------------------
alter table public.tasks
  add column if not exists reminder_sent_at timestamptz;

comment on column public.tasks.reminder_sent_at is
  'Idempotency flag (tb-notifications-task-due-reminder-001): the due-date '
  'reminder email/notification fires at most once per task. Reset to null '
  'if due_date is pushed out past the 1-day lead-time window again, so a '
  'genuine re-approach re-warns.';

-- ----------------------------------------------------------------------------
-- Daily cron trigger -> Edge Function. Reuses the existing project-wide
-- contract_expiry_cron_secret Vault secret / CRON_SECRET value -- confirmed
-- shared across every deployed function by tb-listings-authority-expiry-
-- notification-001, no new secret bootstrap needed.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'task-due-reminder-daily-check') then
    perform cron.unschedule('task-due-reminder-daily-check');
  end if;
end $$;

select cron.schedule(
  'task-due-reminder-daily-check',
  '0 3 * * *', -- 03:00 UTC daily, offset from the existing three jobs (01:00/02:00 UTC taken)
  $$
  select net.http_post(
    url := 'https://skfnrcwqvmurnpwrmixj.supabase.co/functions/v1/task-due-reminder-check',
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
