-- ============================================================================
-- Migration: Buyer Leads -- Lease End Date (Revisit Page)
-- Implements: tb-buyer-leads-revisit-page-001 (theos-registry)
--
-- Adds a single nullable column capturing the lead's own lease term when a
-- lead is marked won against a rent-type listing, so the brokerage can
-- proactively re-engage the client before the lease ends (recurring-client
-- workflow). Entered directly by the agent -- never derived/calculated here.
--
-- Deliberately independent of tb-properties-unit-leasing-001 (a different,
-- unrelated tracer bullet in this same batch that adds a 'leased' status to
-- properties for a developer's own unit inventory) -- no shared schema, no
-- shared table. This column lives on buyer_requirements (the Lead entity)
-- only, and is unrelated to workspace.contract_end_date (a workspace's own
-- SaaS contract with Residoro).
--
-- No RLS changes: existing row-scoped policies on buyer_requirements
-- (buyer_requirements_select_tenant / _update_tenant / etc., from
-- 20260728160000_buyer_leads_schema.sql) already cover this column.
-- ============================================================================

alter table public.buyer_requirements
  add column lease_end_date date;

comment on column public.buyer_requirements.lease_end_date is
  'Client-facing lease end date for this lead''s own won rental deal, captured optionally on '
  'PATCH /buyer-requirements/:id/mark-won when won_listing_id resolves to a rent-type listing '
  '(required in that case; left null for sale-type wins). Entered directly by the agent, never '
  'auto-calculated. Powers the Revisit page (tb-buyer-leads-revisit-page-001) for lease-renewal '
  'follow-up. Not to be confused with workspace.contract_end_date (Residoro''s own SaaS contract '
  'with the workspace) or properties.status=''leased'' (tb-properties-unit-leasing-001''s '
  'unrelated developer-inventory concept).';
