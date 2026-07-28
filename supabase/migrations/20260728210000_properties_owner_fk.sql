-- ============================================================================
-- Migration: properties.owner_id -- Real Foreign Key into Contacts
-- Implements: tb-crm-owner-fk-001 (theos-registry), Milestone 2 of cap-crm-001
--
-- Closes the "no FK: polymorphic target doesn't exist yet" gap named in
-- properties' original migration (20260721120000_platform_foundation.sql),
-- now that contacts is the single canonical table owner_id could point at.
--
-- Pre-migration integrity check (run manually against the linked project
-- before this file was applied) found 2 orphaned rows in a tenant with zero
-- contacts rows at all (pre-CRM-consolidation test fixtures) -- resolved by
-- nulling owner_id on those 2 rows per the user's explicit decision
-- 2026-07-28, not by this migration itself. See tb-crm-owner-fk-001's Notes.
-- ============================================================================

alter table public.properties
  add constraint properties_owner_id_fkey
  foreign key (owner_id) references public.contacts(id);
