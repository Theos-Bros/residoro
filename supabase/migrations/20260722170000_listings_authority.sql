-- ============================================================================
-- Migration: Listings Authority (Exclusivity & Authority-to-Sell/Lease Dates)
-- Implements: tb-listings-authority-001 (theos-registry)
--
-- Additive extension of tb-listings-create-001's `listings` table -- adds the
-- exclusivity flag and Authority-to-Sell/Lease term dates that tracer bullet
-- deliberately deferred (see cap-listings-001 Milestone 2). No RLS changes:
-- existing row-scoped policies already cover these new columns.
-- ============================================================================

alter table public.listings
  add column if not exists exclusivity text not null default 'open'
    check (exclusivity in ('exclusive', 'open')),
  add column if not exists authority_starts_at timestamptz not null default now(),
  add column if not exists authority_expires_at timestamptz;

comment on column public.listings.exclusivity is
  'exclusive | open (non-exclusive) -- mirrors the real Authority to Sell/Lease agreement '
  'type. Enforcement is a soft warning only (cap-listings-001 Decision #2), never a hard '
  'block, per tb-listings-authority-001.';
comment on column public.listings.authority_starts_at is
  'Start of the Authority to Sell/Lease agreement term -- distinct from the listing''s own '
  'draft/active/withdrawn status.';
comment on column public.listings.authority_expires_at is
  'End of the Authority to Sell/Lease agreement term, nullable (open-ended authority is '
  'allowed). No automated renewal notification yet -- see cap-listings-001 Automation & Tasks.';
