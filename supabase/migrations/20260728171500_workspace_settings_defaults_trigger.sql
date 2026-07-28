-- ============================================================================
-- Migration: Auto-Provision Per-Workspace Settings Rows
--
-- Bug found while verifying tb-buyer-leads-matching-001: 20260728120000 split
-- sharing_templates/performance settings into their own one-row-per-tenant
-- tables, but POST /admin/clients (application/backend/src/routes/admin.ts)
-- only ever inserts into `workspaces` -- it was never updated to also seed
-- workspace_sharing_settings/workspace_performance_settings. Any tenant
-- created since that migration has NO row in either table, so
-- GET /settings/share-templates, /settings/performance, and now
-- /settings/matching all 500 for them ("Could not load ... settings"). Not
-- caught earlier because every tenant used in manual testing predates
-- 20260728120000. Confirmed via this tracer bullet's own verify script
-- (a throwaway tenant created fresh hit exactly this).
--
-- Fix: a trigger, not another manual insert call site to remember -- any
-- future settings table gets covered automatically as long as it's added to
-- this function, and no application-code call site can forget it again.
-- ============================================================================

create or replace function public.provision_workspace_settings_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_sharing_settings (tenant_id) values (new.id)
    on conflict (tenant_id) do nothing;
  insert into public.workspace_performance_settings (tenant_id) values (new.id)
    on conflict (tenant_id) do nothing;
  insert into public.workspace_matching_settings (tenant_id) values (new.id)
    on conflict (tenant_id) do nothing;
  return new;
end;
$$;

comment on function public.provision_workspace_settings_defaults() is
  'Fires after every workspaces insert -- seeds a default row in every '
  'per-tenant settings table (workspace_sharing_settings, '
  'workspace_performance_settings, workspace_matching_settings) so no '
  'Settings sub-panel 500s for a freshly created tenant. Add new settings '
  'tables here, not to individual insert call sites.';

drop trigger if exists trg_provision_workspace_settings_defaults on public.workspaces;
create trigger trg_provision_workspace_settings_defaults
  after insert on public.workspaces
  for each row execute function public.provision_workspace_settings_defaults();

-- Backfill: any tenant created between 20260728120000 and now that's missing
-- a row in either older settings table (this migration's own
-- workspace_matching_settings insert already covered every existing tenant).
insert into public.workspace_sharing_settings (tenant_id)
select id from public.workspaces
on conflict (tenant_id) do nothing;

insert into public.workspace_performance_settings (tenant_id)
select id from public.workspaces
on conflict (tenant_id) do nothing;
