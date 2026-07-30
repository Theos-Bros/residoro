-- ============================================================================
-- Migration: Unit-Level Leased Status + Lease Terms
-- Implements: tb-properties-unit-leasing-001 (theos-registry)
--
-- Adds 'leased' as a fifth terminal properties.status value, distinct from
-- listings.listing_type = 'rent' (an unrelated concept -- listing_type is
-- active marketing/authority for a unit, not that the unit has already been
-- rented out). Also adds lease_monthly_rent/lease_term_months, populated
-- only when status = 'leased' -- enforced at the application layer (see
-- PATCH /properties/:id in application/backend/src/routes/listings.ts),
-- matching this codebase's existing convention of app-level-only validation
-- for conditional-on-status fields (e.g. listings.buyer_contact_id required
-- only when a listing is marked 'sold' -- no DB constraint for that either).
-- No backfill of existing sold/off_market rows, per decision.
-- ============================================================================

alter table public.properties
  drop constraint if exists properties_status_check;

alter table public.properties
  add constraint properties_status_check check (status in (
    'available', 'reserved', 'sold', 'off_market', 'leased'
  ));

alter table public.properties
  add column if not exists lease_monthly_rent numeric(14,2),
  add column if not exists lease_term_months smallint;

comment on column public.properties.lease_monthly_rent is
  'Monthly rent amount, PHP by default like price/price_currency -- reuses '
  'price_currency''s semantics rather than a second currency column. Null '
  'for every status other than ''leased''; enforced app-side.';
comment on column public.properties.lease_term_months is
  'Plain integer lease duration in months -- no lease start date, no '
  'expiry/renewal tracking (out of scope for tb-properties-unit-leasing-001). '
  'Null for every status other than ''leased''; enforced app-side.';
