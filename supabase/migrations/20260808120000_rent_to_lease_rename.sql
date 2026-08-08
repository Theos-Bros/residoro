-- Eliminate "rent" from the app's vocabulary; replace with "lease" everywhere.
-- Reverses cap-buyer-leads-001's original decision to keep listings-side "rent"
-- and buyer-side "lease" as two different terms for the same concept.
-- See tb-listings-rent-to-lease-001 for full scoping and blast-radius search.

-- 1. Drop both check constraints first -- the old constraint only allows
--    ('sale', 'rent') and would reject the data migration's 'lease' values.
alter table public.listings
  drop constraint if exists listings_listing_type_check;

alter table public.project_unit_types
  drop constraint if exists project_unit_types_listing_type_check;

-- 2. Data migration.
update public.listings set listing_type = 'lease' where listing_type = 'rent';

-- 3. Recreate both check constraints with the new allowed values (verified
--    live 2026-08-08 via pg_constraint that these are the actual
--    Postgres-default names).
alter table public.listings
  add constraint listings_listing_type_check check (listing_type in ('sale', 'lease'));

alter table public.project_unit_types
  add constraint project_unit_types_listing_type_check check (listing_type in ('sale', 'lease'));

-- 4. Column rename -- pure schema op, 0 live rows populated as of 2026-08-08.
alter table public.properties
  rename column lease_monthly_rent to lease_monthly_amount;
