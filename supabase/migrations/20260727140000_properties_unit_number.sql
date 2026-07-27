-- tb-properties-project-rollup-001 follow-up: a free-form label for a unit's
-- position within its development -- floor+unit letter for condos (e.g.
-- "1F"), block+lot for house-and-lot/subdivisions (e.g. "Block 3 Lot 12").
-- Nullable and never backfilled for properties generated before this change
-- (per the user's explicit decision -- no retroactive migration).
alter table public.properties
  add column if not exists unit_number text;
