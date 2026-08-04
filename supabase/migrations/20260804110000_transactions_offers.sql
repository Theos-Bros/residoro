-- ============================================================================
-- Migration: Transactions -- Offers & Negotiation
-- Implements: tb-transactions-offers-001 (theos-registry)
--
-- Adds a real `offers` table behind the existing, previously-inert
-- buyer_requirements.stage = 'negotiating' label, and gives listings.status's
-- 'under_offer' transition (shipped in tb-listings-status-ladder-001, never
-- wired up until now) its first real writer.
-- ============================================================================

create table public.offers (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.workspaces(id),
  buyer_requirement_id uuid not null references public.buyer_requirements(id),
  listing_id           uuid not null references public.listings(id),

  offered_by           text not null check (offered_by in ('buyer', 'seller')),
  amount               numeric not null,
  currency             text not null default 'PHP',
  terms                text,
  status               text not null default 'pending'
                         check (status in ('pending', 'countered', 'accepted', 'rejected', 'withdrawn')),
  -- Points at the offer this one counters. The chain (walk supersedes_offer_id
  -- backward) is the negotiation history for one buyer_requirement + listing
  -- pair -- no separate "negotiation" entity.
  supersedes_offer_id  uuid references public.offers(id),

  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index idx_offers_tenant_id on public.offers (tenant_id);
create index idx_offers_buyer_requirement_id on public.offers (buyer_requirement_id);
create index idx_offers_listing_id on public.offers (listing_id);
create index idx_offers_supersedes_offer_id on public.offers (supersedes_offer_id);

create trigger trg_offers_updated_at before update on public.offers
  for each row execute function public.set_updated_at();

-- RLS: tenant-scoped CRUD, same shape as viewings -- an offer record is an
-- operational log entry correctable by whoever's workspace it belongs to,
-- not a core record requiring admin-only delete (buyer_requirements/contacts'
-- pattern).

alter table public.offers enable row level security;

create policy offers_select_tenant on public.offers for select
  using (tenant_id = public.current_tenant_id());
create policy offers_insert_tenant on public.offers for insert
  with check (tenant_id = public.current_tenant_id());
create policy offers_update_tenant on public.offers for update
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy offers_delete_tenant on public.offers for delete
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.offers to authenticated;
grant all on public.offers to service_role;
