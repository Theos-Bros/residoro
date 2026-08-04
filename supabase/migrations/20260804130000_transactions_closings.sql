-- ============================================================================
-- Migration: Transactions -- Closing (Completion Checklist & Final Deal Event)
-- Implements: tb-transactions-closing-001 (theos-registry)
--
-- Adds a real `closings` table seeded from a signed contract, giving the
-- second half of the existing buyer_requirements.stage = 'contract_closing'
-- label a real record and producing the completion event cap-commission-001
-- computes earnings from.
-- ============================================================================

create table public.closings (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.workspaces(id),
  -- One closing per contract -- prevents double-opening a closing against
  -- the same signed contract, same reasoning as contracts.offer_id's own
  -- unique constraint.
  contract_id          uuid not null references public.contracts(id),
  buyer_requirement_id uuid not null references public.buyer_requirements(id),
  listing_id           uuid not null references public.listings(id),

  final_price          numeric not null,
  currency             text not null default 'PHP',
  -- Extensible bag for future closing-checklist items. TB1 keeps the actual
  -- checklist minimal (final price + completion date, both real columns) --
  -- unused by any code path today, reserved per the tracer bullet's own
  -- schema sketch.
  checklist_state      jsonb not null default '{}',
  completed_at         timestamptz,

  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index idx_closings_contract_id on public.closings (contract_id);
create index idx_closings_tenant_id on public.closings (tenant_id);
create index idx_closings_buyer_requirement_id on public.closings (buyer_requirement_id);
create index idx_closings_listing_id on public.closings (listing_id);

create trigger trg_closings_updated_at before update on public.closings
  for each row execute function public.set_updated_at();

-- RLS: tenant-scoped CRUD, same shape as contracts/offers/viewings.

alter table public.closings enable row level security;

create policy closings_select_tenant on public.closings for select
  using (tenant_id = public.current_tenant_id());
create policy closings_insert_tenant on public.closings for insert
  with check (tenant_id = public.current_tenant_id());
create policy closings_update_tenant on public.closings for update
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy closings_delete_tenant on public.closings for delete
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.closings to authenticated;
grant all on public.closings to service_role;
