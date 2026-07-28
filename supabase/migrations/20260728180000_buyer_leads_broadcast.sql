-- ============================================================================
-- Migration: Buyer Wanted Broadcast -- Third Sharing Template Tier
-- Implements: tb-buyer-leads-broadcast-001 (theos-registry)
--
-- Reuses workspace_sharing_settings (20260728120000) and its existing
-- has_settings_delegation('sharing_templates') RLS policy unchanged -- a
-- third column, not a new setting_key or a new table. Naming matches the
-- existing public_share_template/co_broker_share_template convention
-- (corrected from the tracer bullet's own capability doc, which had
-- originally sketched `buyer_wanted_template`).
-- ============================================================================

alter table public.workspace_sharing_settings
  add column if not exists buyer_wanted_share_template text;

-- provision_workspace_settings_defaults() (20260728171500) only ever inserts
-- (tenant_id) into workspace_sharing_settings and relies on column defaults
-- for the rest -- a nullable addition here needs no change to that function.
