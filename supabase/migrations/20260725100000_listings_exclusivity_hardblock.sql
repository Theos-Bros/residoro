-- ============================================================================
-- Migration: Per-Brokerage Exclusivity Hard-Block Setting
-- Implements: tb-listings-exclusivity-hardblock-001 (theos-registry)
--
-- Additive extension of public.workspaces -- adds the operator-only toggle
-- that turns tb-listings-authority-001's soft exclusivity warning into a
-- hard block for a specific brokerage, per cap-listings-001 Decision #2.
-- Defaults to false for every existing and future workspace: no behavior
-- change unless an operator explicitly opts a brokerage in. No RLS changes:
-- this column is only ever read/written by operator-only backend routes.
-- ============================================================================

alter table public.workspaces
  add column if not exists exclusivity_hard_block boolean not null default false;

comment on column public.workspaces.exclusivity_hard_block is
  'Per-brokerage override of tb-listings-authority-001''s default soft-warning exclusivity '
  'enforcement -- true means activating a listing that conflicts with an existing active '
  'exclusive listing on the same property is rejected (409), not just flagged with a '
  'warning. Operator-set only via PATCH /admin/clients/:id/listings-policy, default false, '
  'per cap-listings-001 Decision #2 and tb-listings-exclusivity-hardblock-001.';
