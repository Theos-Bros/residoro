-- ============================================================================
-- Migration: Settings Edit Delegation
-- Implements: tb-brokerage-permissions-delegation-001 (theos-registry)
-- Lets an admin grant a specific member edit rights on a specific Settings
-- sub-section (sharing_templates, performance) without making them an admin.
-- An admin's own edit rights never come from this table -- see the tracer
-- bullet's Context on why "owner" = "admin" needs no protected-row guard here.
-- ============================================================================

create table if not exists public.settings_edit_delegations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.workspaces(id),
  member_id   uuid not null references public.profiles(id),
  setting_key text not null check (setting_key in ('sharing_templates', 'performance')),
  granted_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  unique (tenant_id, member_id, setting_key)
);

comment on table public.settings_edit_delegations is
  'Per-member, per-Settings-sub-section edit grants (tb-brokerage-permissions-'
  'delegation-001). Additive on top of the admin|member|operator role model --'
  ' an admin''s own edit rights always come from role = ''admin'', never from a '
  'row here.';

create index if not exists idx_settings_edit_delegations_tenant_member
  on public.settings_edit_delegations (tenant_id, member_id);

alter table public.settings_edit_delegations enable row level security;

-- Same tenant-wide read pattern as property_documents/listing_share_events --
-- any tenant member can read who has what (needed so a delegated member's own
-- GET can compute can_edit). Insert/update/delete policies (admin-only) are
-- added in 20260728120000_settings_delegation_rls_tables.sql, once the
-- per-setting tables that make full RLS enforcement possible also exist --
-- see that migration's header for why this one alone isn't the final state.
create policy settings_edit_delegations_select_tenant on public.settings_edit_delegations
  for select
  using (tenant_id = (select public.current_tenant_id()));

grant select on public.settings_edit_delegations to authenticated;
grant all on public.settings_edit_delegations to service_role;
