-- ============================================================================
-- Migration: Transactions -- Viewing Scheduling & Outcome Tracking
-- Implements: tb-transactions-viewings-001 (theos-registry)
--
-- Adds a real `viewings` table behind the existing, previously-inert
-- buyer_requirements.stage = 'viewing' label (shipped in
-- tb-buyer-leads-schema-001's full 9-stage enum, never automated until now).
-- ============================================================================

create table public.viewings (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.workspaces(id),
  buyer_requirement_id uuid not null references public.buyer_requirements(id),
  listing_id           uuid not null references public.listings(id),

  scheduled_at         timestamptz not null,
  outcome              text not null default 'scheduled'
                         check (outcome in ('scheduled', 'completed', 'no_show', 'cancelled')),
  feedback             text,

  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index idx_viewings_tenant_id on public.viewings (tenant_id);
create index idx_viewings_buyer_requirement_id on public.viewings (buyer_requirement_id);
create index idx_viewings_listing_id on public.viewings (listing_id);

create trigger trg_viewings_updated_at before update on public.viewings
  for each row execute function public.set_updated_at();

-- RLS: tenant-scoped CRUD, no admin-only delete gate -- a viewing log entry
-- is closer to buyer_requirement_matches (operational record, tenant-wide
-- delete) than to buyer_requirements/contacts (core record, admin-only hard
-- delete), since a mis-scheduled viewing is expected to be correctable by
-- whoever logged it, not just an admin.

alter table public.viewings enable row level security;

create policy viewings_select_tenant on public.viewings for select
  using (tenant_id = public.current_tenant_id());
create policy viewings_insert_tenant on public.viewings for insert
  with check (tenant_id = public.current_tenant_id());
create policy viewings_update_tenant on public.viewings for update
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy viewings_delete_tenant on public.viewings for delete
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.viewings to authenticated;
grant all on public.viewings to service_role;
