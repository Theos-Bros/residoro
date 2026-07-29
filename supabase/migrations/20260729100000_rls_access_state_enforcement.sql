-- ============================================================================
-- Migration: RLS-level contract-expiry enforcement
-- Fixes: HIGH finding in docs/security-review-2026-07-29.md
--
-- requireAuth (application/backend/src/lib/auth.ts) already rejects
-- 'blocked' workspaces outright and restricts 'read_only' ones to GET -- but
-- that check only runs inside the Fastify app. ADR-003's whole point is that
-- the frontend's publishable key + a user's own JWT are legitimate
-- standalone credentials against Supabase's REST API (that's what
-- getScopedClient forwards) -- which means those same two values, already
-- sitting in a logged-in browser, are enough to call Supabase directly and
-- skip the Fastify app (and its access_state gate) entirely. The 2026-07-29
-- review proved this live: a workspace set to 'blocked' could still be read
-- from AND written to via a direct PostgREST call.
--
-- Fix: push access_state into the RLS layer itself, at the two helper
-- functions every existing policy already calls through:
--   - current_tenant_id() now returns NULL once the caller's workspace is
--     'blocked' -- since every SELECT/INSERT/UPDATE/DELETE policy on every
--     tenant-scoped table compares tenant_id = current_tenant_id(), this one
--     change cuts a blocked tenant off from all of them uniformly, with no
--     per-table policy edits needed.
--   - a new current_tenant_id_writable() returns NULL for 'blocked' OR
--     'read_only' (only non-null when 'active'), and every WRITE policy
--     (INSERT/UPDATE/DELETE) is repointed at it below -- SELECT policies
--     keep using current_tenant_id(), so read_only's "reads still work"
--     behavior is preserved at the RLS layer too, matching requireAuth's
--     existing GET-only allowance.
--
-- Known residual scope: listing_dockets' SELECT/UPDATE policies key off
-- shared_by/shared_with (docket participant identity), not tenant_id, so a
-- blocked tenant's already-shared dockets aren't covered by this change --
-- narrower surface than the tenant-data tables this migration closes, and
-- not something the live-tested finding demonstrated. Flagging inline per
-- this repo's own convention rather than silently leaving it unstated.
-- ============================================================================

create or replace function public.current_tenant_id()
returns uuid
language sql
stable security definer
set search_path = ''
as $$
  select p.tenant_id
  from public.profiles p
  join public.workspaces w on w.id = p.tenant_id
  where p.id = auth.uid()
    and w.access_state <> 'blocked';
$$;

comment on function public.current_tenant_id() is
  'Returns the caller''s tenant_id, or NULL if they have no workspace, are an '
  'operator (tenant_id null by design), or their workspace is blocked. Every '
  'RLS policy on every tenant-scoped table compares tenant_id against this, so '
  'a blocked workspace loses all RLS-authenticated access uniformly. See '
  '2026-07-29 security review.';

create or replace function public.current_tenant_id_writable()
returns uuid
language sql
stable security definer
set search_path = ''
as $$
  select p.tenant_id
  from public.profiles p
  join public.workspaces w on w.id = p.tenant_id
  where p.id = auth.uid()
    and w.access_state = 'active';
$$;

comment on function public.current_tenant_id_writable() is
  'Like current_tenant_id(), but also NULL during the read_only grace period -- '
  'only non-null when the workspace is fully active. Used by INSERT/UPDATE/'
  'DELETE policies so read_only genuinely blocks writes at the RLS layer, not '
  'just in requireAuth. See 2026-07-29 security review.';

alter policy "brm_delete_tenant" on public.buyer_requirement_matches
  using ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "brm_insert_tenant" on public.buyer_requirement_matches
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "buyer_requirements_delete_admin" on public.buyer_requirements
  using (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND (( SELECT "current_role"() AS "current_role") = 'admin'::text)));

alter policy "buyer_requirements_insert_tenant" on public.buyer_requirements
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "buyer_requirements_update_tenant" on public.buyer_requirements
  using ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)))
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "contacts_delete_admin" on public.contacts
  using (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND (( SELECT "current_role"() AS "current_role") = 'admin'::text)));

alter policy "contacts_insert_tenant" on public.contacts
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "contacts_update_tenant" on public.contacts
  using ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)))
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "inquiries_delete_admin" on public.inquiries
  using (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND (( SELECT "current_role"() AS "current_role") = 'admin'::text)));

alter policy "inquiries_insert_tenant" on public.inquiries
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "inquiries_update_tenant" on public.inquiries
  using ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)))
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "listing_dockets_insert_sharer" on public.listing_dockets
  with check (((shared_by = ( SELECT auth.uid() AS uid)) AND (source_tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id))));

alter policy "listing_share_events_insert_tenant" on public.listing_share_events
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "listings_insert_tenant" on public.listings
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "listings_update_tenant" on public.listings
  using ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)))
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "project_unit_types_delete_admin" on public.project_unit_types
  using (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND (( SELECT "current_role"() AS "current_role") = 'admin'::text)));

alter policy "project_unit_types_insert_tenant" on public.project_unit_types
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "project_unit_types_update_tenant" on public.project_unit_types
  using ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)))
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "projects_delete_admin" on public.projects
  using (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND (( SELECT "current_role"() AS "current_role") = 'admin'::text)));

alter policy "projects_insert_tenant" on public.projects
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "projects_update_tenant" on public.projects
  using ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)))
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "properties_delete_admin" on public.properties
  using (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND (( SELECT "current_role"() AS "current_role") = 'admin'::text)));

alter policy "properties_insert_tenant" on public.properties
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "properties_update_tenant" on public.properties
  using ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)))
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "property_documents_delete_tenant" on public.property_documents
  using ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "property_documents_insert_tenant" on public.property_documents
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "property_media_delete_tenant" on public.property_media
  using ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "property_media_insert_tenant" on public.property_media
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "property_media_update_tenant" on public.property_media
  using ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)))
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "settings_edit_delegations_delete_admin" on public.settings_edit_delegations
  using (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND (( SELECT "current_role"() AS "current_role") = 'admin'::text)));

alter policy "settings_edit_delegations_insert_admin" on public.settings_edit_delegations
  with check (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND (( SELECT "current_role"() AS "current_role") = 'admin'::text)));

alter policy "settings_edit_delegations_update_admin" on public.settings_edit_delegations
  using (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND (( SELECT "current_role"() AS "current_role") = 'admin'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND (( SELECT "current_role"() AS "current_role") = 'admin'::text)));

alter policy "tasks_delete_admin" on public.tasks
  using (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND (( SELECT "current_role"() AS "current_role") = 'admin'::text)));

alter policy "tasks_insert_tenant" on public.tasks
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "tasks_update_tenant" on public.tasks
  using ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)))
  with check ((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));

alter policy "workspace_matching_settings_update_delegated" on public.workspace_matching_settings
  using (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND has_settings_delegation('matching'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND has_settings_delegation('matching'::text)));

alter policy "workspace_performance_settings_update_delegated" on public.workspace_performance_settings
  using (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND has_settings_delegation('performance'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND has_settings_delegation('performance'::text)));

alter policy "workspace_sharing_settings_update_delegated" on public.workspace_sharing_settings
  using (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND has_settings_delegation('sharing_templates'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND has_settings_delegation('sharing_templates'::text)));

alter policy "task_routing_write_delegated" on public.workspace_task_routing_settings
  using (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND has_settings_delegation('tasks'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND has_settings_delegation('tasks'::text)));

alter policy "workspaces_update_admin" on public.workspaces
  using (((id = ( SELECT current_tenant_id_writable() AS current_tenant_id)) AND (( SELECT "current_role"() AS "current_role") = 'admin'::text)))
  with check ((id = ( SELECT current_tenant_id_writable() AS current_tenant_id)));
