-- ============================================================================
-- Migration: Listing Status Ladder (add 'inactive')
-- Implements: tb-listings-status-ladder-001 (theos-registry)
--
-- Widens listings.status to add 'inactive', a new pausable state reachable
-- from 'active' (active <-> inactive), additive alongside 'draft' -- not a
-- replacement for it. Legal-transition enforcement stays in the backend
-- (listings.ts), same as tb-listings-lifecycle-001's original constraint.
-- No RLS changes: existing row-scoped policies already cover this column.
-- ============================================================================

alter table public.listings
  drop constraint if exists listings_status_check;

alter table public.listings
  add constraint listings_status_check
  check (status in ('draft', 'active', 'under_offer', 'sold', 'expired', 'withdrawn', 'inactive'));

comment on column public.listings.status is
  'draft -> active <-> inactive -> under_offer -> sold | expired | withdrawn. Legal transitions '
  'enforced in application code (listings.ts), not here. Listings are never deleted -- reassigning '
  'to a new agent means withdrawing this row and creating a new listing, per tb-listings-lifecycle-001.';
