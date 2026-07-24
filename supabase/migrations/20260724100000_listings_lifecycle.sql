-- ============================================================================
-- Migration: Listing Lifecycle (widen status enum)
-- Implements: tb-listings-lifecycle-001 (theos-registry)
--
-- Widens listings.status from ('draft', 'active', 'withdrawn') to the full
-- state machine cap-listings-001 Milestone 3 names: draft, active,
-- under_offer, sold, expired, withdrawn. Legal-transition enforcement itself
-- lives in the backend (listings.ts), not a DB trigger -- same
-- application-layer precedent as this codebase's other status fields. No RLS
-- changes: existing row-scoped policies already cover this column.
-- ============================================================================

alter table public.listings
  drop constraint if exists listings_status_check;

alter table public.listings
  add constraint listings_status_check
  check (status in ('draft', 'active', 'under_offer', 'sold', 'expired', 'withdrawn'));

comment on column public.listings.status is
  'draft -> active -> under_offer -> sold | expired | withdrawn. Legal transitions enforced '
  'in application code (listings.ts), not here. Listings are never deleted -- reassigning to '
  'a new agent means withdrawing this row and creating a new listing, per tb-listings-lifecycle-001.';
