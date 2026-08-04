-- ============================================================================
-- Migration: Transactions -- Contract (Agreed Terms & Signing Status)
-- Implements: tb-transactions-contract-001 (theos-registry)
--
-- Adds a real `contracts` table seeded from an accepted offer, giving the
-- first half of the existing buyer_requirements.stage = 'contract_closing'
-- label a real record. The second half (Closing) is tb-transactions-closing-001.
-- ============================================================================

create table public.contracts (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.workspaces(id),
  buyer_requirement_id uuid not null references public.buyer_requirements(id),
  listing_id           uuid not null references public.listings(id),
  -- One contract per accepted offer -- the unique constraint below prevents
  -- double-creation (e.g. a double-click on "Create Contract") rather than
  -- expressing a one-contract-per-lead rule; a lease that falls through
  -- ('void') and a later fresh offer/contract cycle on the same lead is a
  -- legitimate second row.
  offer_id             uuid not null references public.offers(id),

  agreed_price         numeric not null,
  currency             text not null default 'PHP',
  terms                text,
  signing_status       text not null default 'drafted'
                         check (signing_status in ('drafted', 'sent', 'signed', 'void')),
  signed_at            timestamptz,

  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index idx_contracts_offer_id on public.contracts (offer_id);
create index idx_contracts_tenant_id on public.contracts (tenant_id);
create index idx_contracts_buyer_requirement_id on public.contracts (buyer_requirement_id);
create index idx_contracts_listing_id on public.contracts (listing_id);

create trigger trg_contracts_updated_at before update on public.contracts
  for each row execute function public.set_updated_at();

-- RLS: tenant-scoped CRUD, same shape as offers/viewings -- an operational
-- record correctable by whoever's workspace it belongs to, not a core
-- record requiring admin-only delete.

alter table public.contracts enable row level security;

create policy contracts_select_tenant on public.contracts for select
  using (tenant_id = public.current_tenant_id());
create policy contracts_insert_tenant on public.contracts for insert
  with check (tenant_id = public.current_tenant_id());
create policy contracts_update_tenant on public.contracts for update
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy contracts_delete_tenant on public.contracts for delete
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.contracts to authenticated;
grant all on public.contracts to service_role;
