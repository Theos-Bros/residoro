-- ============================================================================
-- Migration: Full Property Specs (storeys, features) + Unit-Type Listing Defaults
-- Implements: tb-listings-property-specs-001 (theos-registry)
--
-- properties.storeys/features close a real spec gap alongside the existing
-- bedrooms/bathrooms/parking_slots/floor_area_sqm/lot_area_sqm columns.
-- features is a freeform text[] tag list (per user decision 2026-08-07) --
-- open vocabulary, no fixed value set, matching contacts.type's precedent.
--
-- project_unit_types gains the same storeys/features fields plus
-- listing_type/exclusivity -- the template previously had nothing to source
-- an auto-created listing's marketing fields from, since generate-units
-- never created a listings row at all before this tracer bullet.
-- ============================================================================

alter table public.properties
  add column if not exists storeys smallint,
  add column if not exists features text[];

comment on column public.properties.storeys is
  'Number of floors/levels the property has. Nullable, optional like every '
  'other physical-spec column on this table.';
comment on column public.properties.features is
  'Freeform feature/amenity tags (e.g. "Swimming Pool", "Balcony", "CCTV") '
  '-- open vocabulary, no fixed list, per tb-listings-property-specs-001 '
  'decision. Null or empty array both mean "none recorded".';

alter table public.project_unit_types
  add column if not exists storeys smallint,
  add column if not exists features text[],
  add column if not exists listing_type text not null default 'sale'
    check (listing_type in ('sale', 'rent')),
  add column if not exists exclusivity text not null default 'open'
    check (exclusivity in ('exclusive', 'open'));

comment on column public.project_unit_types.listing_type is
  'Marketing type each generated unit''s auto-created listing should use. '
  'Defaults to sale, matching the most common developer/pre-selling case.';
comment on column public.project_unit_types.exclusivity is
  'Exclusivity each generated unit''s auto-created listing should use. '
  'Defaults to open, matching listings.exclusivity''s own column default.';
