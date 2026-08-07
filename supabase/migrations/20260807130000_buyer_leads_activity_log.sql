-- ============================================================================
-- Migration: Buyer Lead Activity Log -- manually-logged running history
-- Implements: tb-buyer-leads-activity-log-001 (theos-registry)
--
-- Deliberately a new, general-purpose table -- not a reuse of
-- buyer_requirement_match_logs (20260806120000), which is scoped narrowly to
-- matched-listing events only. This log is for whatever an agent wants to
-- record about a lead (call/email/meeting/note), and doubles as the "Last
-- contact" signal (computed client/query-side as the max occurred_at, no
-- separate denormalized column).
-- ============================================================================

create table public.buyer_requirement_activity_log (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.workspaces(id) on delete cascade,
  buyer_requirement_id  uuid not null references public.buyer_requirements(id) on delete cascade,
  activity_type         text not null check (activity_type in ('call', 'email', 'meeting', 'note', 'other')),
  notes                 text,
  occurred_at           timestamptz not null default now(),
  logged_by             uuid references auth.users(id),
  created_at            timestamptz not null default now()
);

comment on table public.buyer_requirement_activity_log is
  'tb-buyer-leads-activity-log-001: manually-logged running history for a '
  'Lead (call/email/meeting/note) -- append-only, whole-brokerage visible. '
  '"Last contact" is derived as max(occurred_at) per buyer_requirement_id, '
  'not a separate column.';

create index idx_bral_tenant_id on public.buyer_requirement_activity_log (tenant_id);
create index idx_bral_buyer_requirement_id_occurred_at
  on public.buyer_requirement_activity_log (buyer_requirement_id, occurred_at desc);

-- RLS: same tenant-scoped, whole-brokerage-visible, append-only pattern as
-- buyer_requirement_match_logs (20260806120000) -- no agent-assignment
-- concept in cap-buyer-leads-001, so no per-agent restriction here either.
alter table public.buyer_requirement_activity_log enable row level security;

create policy bral_select_tenant on public.buyer_requirement_activity_log for select
  using (tenant_id = (select public.current_tenant_id()));
create policy bral_insert_tenant on public.buyer_requirement_activity_log for insert
  with check (tenant_id = (select public.current_tenant_id()));
-- No update/delete policy: append-only, matching buyer_requirement_match_logs'
-- own precedent -- a wrong entry gets a corrective follow-up entry, not an edit.

grant select, insert on public.buyer_requirement_activity_log to authenticated;
grant all on public.buyer_requirement_activity_log to service_role;
