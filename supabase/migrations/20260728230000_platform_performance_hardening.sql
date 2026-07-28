-- ============================================================================
-- Migration: Platform Performance Hardening -- Missing FK Indexes & Unwrapped
--            RLS Auth Calls
-- Implements: tb-platform-performance-hardening-001 (theos-registry)
--
-- Two classic Supabase Performance Advisor findings, reproduced directly
-- against the linked project via pg_catalog/pg_policies inspection (the
-- MCP advisor tool is only authorized for an inactive demo project, not the
-- real "Residoro Prototype" project). Both are pure schema/policy-definition
-- changes with zero application-code touch and zero access-control-behavior
-- change -- see tb-platform-performance-hardening-001's Context for the full
-- audit and the detection queries used to confirm both findings live.
--
-- Fix 1: 28 foreign-key columns across 19 tables have no covering index, so
-- every delete/update on the referenced row (and every join through the FK)
-- forces a sequential scan on the referencing table. One single-column btree
-- index per column, matching this codebase's existing idx_<table>_<column>
-- convention (e.g. idx_properties_tenant_id, idx_listings_property_id).
--
-- Fix 2: 30 RLS policies across 11 tables call current_tenant_id() /
-- current_role() / auth.uid() bare inside USING/WITH CHECK, so Postgres
-- re-evaluates the call once per row instead of once per query. This
-- codebase already uses the (select fn()) InitPlan-folding pattern
-- consistently elsewhere (buyer_requirement_matches, profiles, properties,
-- and -- as of 20260728190000_buyer_leads_rls_perf_align.sql and
-- 20260728200000_tasks_schema.sql -- the tenant_id half of several of the
-- policies touched here); this migration brings the remaining stragglers in
-- line with that existing convention. Every policy below is DROP + CREATE
-- with byte-for-byte-identical boolean logic to what's live today (verified
-- via `supabase db query --linked` against pg_policies.qual/with_check
-- immediately before writing this file) -- only the function-call wrapping
-- changes. No TO clause is added anywhere: every affected policy's `roles`
-- is `{public}` (the default) today, confirmed the same way.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Fix 1: missing FK indexes (28 columns / 19 tables, 28 CREATE INDEX
-- statements, one per column -- no composite indexes, matching the existing
-- single-column idx_<table>_<column> convention used throughout this schema)
-- ----------------------------------------------------------------------------

-- buyer_requirement_matches
create index if not exists idx_buyer_requirement_matches_listing_id
  on public.buyer_requirement_matches (listing_id);
create index if not exists idx_buyer_requirement_matches_created_by
  on public.buyer_requirement_matches (created_by);

-- buyer_requirements
create index if not exists idx_buyer_requirements_source_inquiry_id
  on public.buyer_requirements (source_inquiry_id);
create index if not exists idx_buyer_requirements_won_listing_id
  on public.buyer_requirements (won_listing_id);
create index if not exists idx_buyer_requirements_created_by
  on public.buyer_requirements (created_by);

-- contacts
create index if not exists idx_contacts_created_by
  on public.contacts (created_by);

-- import_batches
create index if not exists idx_import_batches_created_by
  on public.import_batches (created_by);
create index if not exists idx_import_batches_temp_file_id
  on public.import_batches (temp_file_id);

-- imported_contacts
create index if not exists idx_imported_contacts_contact_id
  on public.imported_contacts (contact_id);

-- imported_properties
create index if not exists idx_imported_properties_property_id
  on public.imported_properties (property_id);

-- inquiries
create index if not exists idx_inquiries_probed_by
  on public.inquiries (probed_by);
create index if not exists idx_inquiries_promoted_lead_id
  on public.inquiries (promoted_lead_id);
create index if not exists idx_inquiries_created_by
  on public.inquiries (created_by);

-- listing_dockets
create index if not exists idx_listing_dockets_source_tenant_id
  on public.listing_dockets (source_tenant_id);

-- listing_share_events
create index if not exists idx_listing_share_events_shared_by
  on public.listing_share_events (shared_by);

-- listings
create index if not exists idx_listings_agent_id
  on public.listings (agent_id);

-- migration_temp_files
create index if not exists idx_migration_temp_files_created_by
  on public.migration_temp_files (created_by);

-- project_unit_types
create index if not exists idx_project_unit_types_created_by
  on public.project_unit_types (created_by);

-- projects
create index if not exists idx_projects_created_by
  on public.projects (created_by);

-- properties (tb-crm-owner-fk-001 gave owner_id a real FK; it still had no
-- covering index)
create index if not exists idx_properties_owner_id
  on public.properties (owner_id);

-- property_documents
create index if not exists idx_property_documents_created_by
  on public.property_documents (created_by);
create index if not exists idx_property_documents_tenant_id
  on public.property_documents (tenant_id);

-- property_media
create index if not exists idx_property_media_tenant_id
  on public.property_media (tenant_id);
create index if not exists idx_property_media_created_by
  on public.property_media (created_by);

-- settings_edit_delegations (existing idx_settings_edit_delegations_tenant_member
-- leads with tenant_id, so it doesn't cover either of these as a leading column)
create index if not exists idx_settings_edit_delegations_granted_by
  on public.settings_edit_delegations (granted_by);
create index if not exists idx_settings_edit_delegations_member_id
  on public.settings_edit_delegations (member_id);

-- tasks
create index if not exists idx_tasks_created_by
  on public.tasks (created_by);

-- workspace_task_routing_settings
create index if not exists idx_workspace_task_routing_settings_default_assignee_id
  on public.workspace_task_routing_settings (default_assignee_id);

-- ----------------------------------------------------------------------------
-- Fix 2: wrap RLS auth-function calls in (select ...) -- 30 policies across
-- 11 tables. Each is DROP POLICY + CREATE POLICY with the same FOR <cmd> and
-- the same USING/WITH CHECK boolean expression that's live today; only the
-- current_tenant_id() / current_role() / auth.uid() calls gain the
-- (select ...) wrapper.
-- ----------------------------------------------------------------------------

-- buyer_requirements: tenant_id half already wrapped by
-- 20260728190000_buyer_leads_rls_perf_align.sql; current_role() is not.
drop policy buyer_requirements_delete_admin on public.buyer_requirements;
create policy buyer_requirements_delete_admin on public.buyer_requirements
  for delete
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role()) = 'admin');

-- contacts
drop policy contacts_delete_admin on public.contacts;
create policy contacts_delete_admin on public.contacts
  for delete
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role()) = 'admin');

drop policy contacts_insert_tenant on public.contacts;
create policy contacts_insert_tenant on public.contacts
  for insert
  with check (tenant_id = (select public.current_tenant_id()));

drop policy contacts_select_tenant on public.contacts;
create policy contacts_select_tenant on public.contacts
  for select
  using (tenant_id = (select public.current_tenant_id()));

drop policy contacts_update_tenant on public.contacts;
create policy contacts_update_tenant on public.contacts
  for update
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- inquiries: tenant_id half already wrapped by
-- 20260728190000_buyer_leads_rls_perf_align.sql; current_role() is not.
drop policy inquiries_delete_admin on public.inquiries;
create policy inquiries_delete_admin on public.inquiries
  for delete
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role()) = 'admin');

-- listing_dockets (identity-scoped via auth.uid(), not tenant-scoped -- see
-- 20260723110000_listing_dockets.sql's own comment on why)
drop policy listing_dockets_insert_sharer on public.listing_dockets;
create policy listing_dockets_insert_sharer on public.listing_dockets
  for insert
  with check (shared_by = (select auth.uid()) and source_tenant_id = (select public.current_tenant_id()));

drop policy listing_dockets_select_participant on public.listing_dockets;
create policy listing_dockets_select_participant on public.listing_dockets
  for select
  using (shared_by = (select auth.uid()) or shared_with = (select auth.uid()));

drop policy listing_dockets_update_sharer on public.listing_dockets;
create policy listing_dockets_update_sharer on public.listing_dockets
  for update
  using (shared_by = (select auth.uid()))
  with check (shared_by = (select auth.uid()));

-- listing_share_events
drop policy listing_share_events_insert_tenant on public.listing_share_events;
create policy listing_share_events_insert_tenant on public.listing_share_events
  for insert
  with check (tenant_id = (select public.current_tenant_id()));

drop policy listing_share_events_select_tenant on public.listing_share_events;
create policy listing_share_events_select_tenant on public.listing_share_events
  for select
  using (tenant_id = (select public.current_tenant_id()));

-- listings
drop policy listings_insert_tenant on public.listings;
create policy listings_insert_tenant on public.listings
  for insert
  with check (tenant_id = (select public.current_tenant_id()));

drop policy listings_select_tenant on public.listings;
create policy listings_select_tenant on public.listings
  for select
  using (tenant_id = (select public.current_tenant_id()));

drop policy listings_update_tenant on public.listings;
create policy listings_update_tenant on public.listings
  for update
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- project_unit_types
drop policy project_unit_types_delete_admin on public.project_unit_types;
create policy project_unit_types_delete_admin on public.project_unit_types
  for delete
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role()) = 'admin');

drop policy project_unit_types_insert_tenant on public.project_unit_types;
create policy project_unit_types_insert_tenant on public.project_unit_types
  for insert
  with check (tenant_id = (select public.current_tenant_id()));

drop policy project_unit_types_select_tenant on public.project_unit_types;
create policy project_unit_types_select_tenant on public.project_unit_types
  for select
  using (tenant_id = (select public.current_tenant_id()));

drop policy project_unit_types_update_tenant on public.project_unit_types;
create policy project_unit_types_update_tenant on public.project_unit_types
  for update
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- projects
drop policy projects_delete_admin on public.projects;
create policy projects_delete_admin on public.projects
  for delete
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role()) = 'admin');

drop policy projects_insert_tenant on public.projects;
create policy projects_insert_tenant on public.projects
  for insert
  with check (tenant_id = (select public.current_tenant_id()));

drop policy projects_select_tenant on public.projects;
create policy projects_select_tenant on public.projects
  for select
  using (tenant_id = (select public.current_tenant_id()));

drop policy projects_update_tenant on public.projects;
create policy projects_update_tenant on public.projects
  for update
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- property_documents (no update policy exists on this table -- confirmed
-- live, only these 3)
drop policy property_documents_delete_tenant on public.property_documents;
create policy property_documents_delete_tenant on public.property_documents
  for delete
  using (tenant_id = (select public.current_tenant_id()));

drop policy property_documents_insert_tenant on public.property_documents;
create policy property_documents_insert_tenant on public.property_documents
  for insert
  with check (tenant_id = (select public.current_tenant_id()));

drop policy property_documents_select_tenant on public.property_documents;
create policy property_documents_select_tenant on public.property_documents
  for select
  using (tenant_id = (select public.current_tenant_id()));

-- property_media
drop policy property_media_delete_tenant on public.property_media;
create policy property_media_delete_tenant on public.property_media
  for delete
  using (tenant_id = (select public.current_tenant_id()));

drop policy property_media_insert_tenant on public.property_media;
create policy property_media_insert_tenant on public.property_media
  for insert
  with check (tenant_id = (select public.current_tenant_id()));

drop policy property_media_select_tenant on public.property_media;
create policy property_media_select_tenant on public.property_media
  for select
  using (tenant_id = (select public.current_tenant_id()));

drop policy property_media_update_tenant on public.property_media;
create policy property_media_update_tenant on public.property_media
  for update
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- tasks: tenant_id half already wrapped by
-- 20260728200000_tasks_schema.sql; current_role() is not.
drop policy tasks_delete_admin on public.tasks;
create policy tasks_delete_admin on public.tasks
  for delete
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role()) = 'admin');
