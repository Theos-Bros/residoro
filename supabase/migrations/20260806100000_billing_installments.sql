-- ============================================================================
-- Migration: Billing -- Contract Value & Installment Tracking
-- Implements: tb-billing-installments-001 (theos-registry)
--
-- No online payment integration exists or is planned (cap-client-lifecycle-001
-- Decision #1) -- these tables are a system of record for a contract's value
-- and its manually-defined installments. All writes go through
-- operator-authenticated /admin/clients/:id/billing... backend routes using
-- the service-role client (tb-client-lifecycle-operator-access-001's
-- established pattern) -- no INSERT/UPDATE/DELETE policy exists for
-- `authenticated` at all. A tenant's own admin gets read-only RLS access to
-- their own tenant's rows; this is the first tenant-owned financial table,
-- and the SELECT policy ships now as baseline tenant-scoping hygiene even
-- though no brokerage-facing UI reads it yet (a later tracer bullet).
-- ============================================================================

create table public.contract_billing (
  tenant_id      uuid primary key references public.workspaces(id) on delete cascade,
  contract_value numeric not null,
  currency       text not null default 'PHP',
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.contract_billing is
  'One row per tenant: the contract''s total value (tb-billing-installments-001). '
  'Written via PUT /admin/clients/:id/billing by an operator only.';

create trigger trg_contract_billing_updated_at before update on public.contract_billing
  for each row execute function public.set_updated_at();

create table public.billing_installments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.workspaces(id) on delete cascade,
  amount     numeric not null,
  currency   text not null default 'PHP',
  due_date   date not null,
  status     text not null default 'unpaid' check (status in ('unpaid', 'paid')),
  paid_date  date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Direct enforcement of the DoD's own invariant ("a paid date recorded
  -- when marked paid") -- distinct from the sum-vs-contract_value question,
  -- which the user confirmed 2026-08-06 stays app-level-warning-only, not a
  -- DB constraint.
  constraint billing_installments_paid_date_matches_status
    check ((status = 'paid') = (paid_date is not null))
);

comment on table public.billing_installments is
  'Manually-defined installments (amount + due date) against a tenant''s contract_billing '
  'record (tb-billing-installments-001). Written via /admin/clients/:id/billing/installments '
  'routes by an operator only. No DB-level constraint ties the sum of a tenant''s installments '
  'to contract_billing.contract_value -- contracts can legitimately change mid-term.';

create index idx_billing_installments_tenant_id on public.billing_installments (tenant_id);

create trigger trg_billing_installments_updated_at before update on public.billing_installments
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.contract_billing enable row level security;
alter table public.billing_installments enable row level security;

create policy contract_billing_select_admin on public.contract_billing
  for select
  using (tenant_id = public.current_tenant_id() and public.current_role() = 'admin');

create policy billing_installments_select_admin on public.billing_installments
  for select
  using (tenant_id = public.current_tenant_id() and public.current_role() = 'admin');

grant select on public.contract_billing, public.billing_installments to authenticated;
grant all on public.contract_billing, public.billing_installments to service_role;
