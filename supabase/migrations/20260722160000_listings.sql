-- ============================================================================
-- Migration: Listings (Create Listing for a Property)
-- Implements: tb-listings-create-001 (theos-registry)
--
-- Smallest real slice of cap-listings-001's marketing-authority model: type,
-- price, and a draft/active/withdrawn status only -- no exclusivity, no full
-- lifecycle state machine, no cross-agent reassignment (see the tracer
-- bullet's semantic_scope). Mirrors public.properties' exact table shape
-- and RLS policy pattern (current_tenant_id()/current_role() helpers from
-- 20260721120000_platform_foundation.sql) for consistency, even though the
-- backend enforces tenant scoping explicitly via supabaseAdmin regardless of
-- these policies -- same defense-in-depth precedent as every other
-- tenant-scoped table in this codebase.
-- ============================================================================

create table if not exists public.listings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.workspaces(id),
  property_id     uuid not null references public.properties(id),
  agent_id        uuid not null references public.profiles(id),
  listing_type    text not null check (listing_type in ('sale', 'rent')),
  price           numeric(14,2) not null,
  price_currency  text not null default 'PHP',
  status          text not null default 'draft' check (status in ('draft', 'active', 'withdrawn')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.listings is
  'Marketing authority over a property (tb-listings-create-001) -- a property can carry zero, '
  'one, or many listings over time. No exclusivity or full lifecycle yet (see cap-listings-001 '
  'Milestone 2/3); status is draft/active/withdrawn only for this pass.';
comment on column public.listings.agent_id is
  'Always the creating profile -- there is no distinct Agent/Team-Lead role in profiles.role '
  '(admin | member only) yet, so cross-agent assignment is deferred, not built here.';

create index if not exists idx_listings_tenant_id on public.listings (tenant_id);
create index if not exists idx_listings_property_id on public.listings (property_id);

create trigger trg_listings_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

alter table public.listings enable row level security;

create policy listings_select_tenant on public.listings
  for select
  using (tenant_id = public.current_tenant_id());

create policy listings_insert_tenant on public.listings
  for insert
  with check (tenant_id = public.current_tenant_id());

create policy listings_update_tenant on public.listings
  for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

grant select, insert, update on public.listings to authenticated;
grant all on public.listings to service_role;
