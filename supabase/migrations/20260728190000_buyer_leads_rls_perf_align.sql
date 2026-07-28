-- Birds-eye pre-scaling audit (2026-07-28) found that 20260728160000_buyer_leads_schema.sql's
-- policies use the bare public.current_tenant_id() call, while 20260728170000_buyer_leads_matching.sql
-- (shipped 10 minutes later the same day) uses the (select public.current_tenant_id()) wrapper that
-- avoids per-row re-evaluation -- the pattern already established in
-- 20260721121500_platform_foundation_hardening.sql and 20260728120000_settings_delegation_rls_tables.sql.
-- Pure query-plan alignment: no behavior change, no data migration.

alter policy inquiries_select_tenant on public.inquiries
  using (tenant_id = (select public.current_tenant_id()));
alter policy inquiries_insert_tenant on public.inquiries
  with check (tenant_id = (select public.current_tenant_id()));
alter policy inquiries_update_tenant on public.inquiries
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
alter policy inquiries_delete_admin on public.inquiries
  using (tenant_id = (select public.current_tenant_id()) and public.current_role() = 'admin');

alter policy buyer_requirements_select_tenant on public.buyer_requirements
  using (tenant_id = (select public.current_tenant_id()));
alter policy buyer_requirements_insert_tenant on public.buyer_requirements
  with check (tenant_id = (select public.current_tenant_id()));
alter policy buyer_requirements_update_tenant on public.buyer_requirements
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
alter policy buyer_requirements_delete_admin on public.buyer_requirements
  using (tenant_id = (select public.current_tenant_id()) and public.current_role() = 'admin');

alter policy brm_select_tenant on public.buyer_requirement_matches
  using (tenant_id = (select public.current_tenant_id()));
alter policy brm_insert_tenant on public.buyer_requirement_matches
  with check (tenant_id = (select public.current_tenant_id()));
alter policy brm_delete_tenant on public.buyer_requirement_matches
  using (tenant_id = (select public.current_tenant_id()));
