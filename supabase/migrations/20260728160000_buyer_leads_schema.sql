-- ============================================================================
-- Migration: Buyer Leads -- Inquiries & Leads Schema
-- Implements: tb-buyer-leads-schema-001 (theos-registry)
--
-- Two new tables: inquiries (spam-tolerant pre-qualification pen) and
-- buyer_requirements (the real Leads pipeline), plus buyer_requirement_matches
-- recording which listings were actually sent as options to a lead.
-- ============================================================================

-- inquiries: pre-qualification pen

create table public.inquiries (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.workspaces(id),

  stage              text not null default 'to_probe'
                       check (stage in ('to_probe', 'probing', 'not_qualified', 'qualified')),
  probed_by          uuid references public.profiles(id),
  source             text,

  buyer_name         text,
  buyer_phone        text,
  buyer_email        text,
  buyer_address      text,

  intent             text check (intent in ('buy', 'lease')),
  property_type      text check (property_type in (
                        'condo_unit', 'house_and_lot', 'lot_only', 'townhouse',
                        'commercial', 'warehouse', 'agricultural', 'industrial'
                      )),
  budget_min         numeric(14,2),
  budget_max         numeric(14,2),
  budget_currency    text not null default 'PHP',
  target_city        text,
  target_province    text,
  floor_area_sqm_min numeric(10,2),
  lot_area_sqm_min   numeric(10,2),
  storeys            smallint,
  bedrooms           smallint,
  bathrooms          smallint,
  household_adults   smallint,
  household_kids     smallint,
  household_pets     smallint,
  notes              text,

  promoted_lead_id   uuid,
  archived_at        timestamptz,

  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- buyer_requirements: the real pipeline ("Leads")

create table public.buyer_requirements (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.workspaces(id),
  contact_id         uuid not null references public.contacts(id),
  source_inquiry_id  uuid references public.inquiries(id),

  stage              text not null default 'registered'
                       check (stage in (
                         'registered', 'searching', 'stalled', 'options_sent',
                         'viewing', 'negotiating', 'contract_closing', 'won', 'lost'
                       )),

  intent             text not null default 'buy' check (intent in ('buy', 'lease')),
  property_type      text check (property_type in (
                        'condo_unit', 'house_and_lot', 'lot_only', 'townhouse',
                        'commercial', 'warehouse', 'agricultural', 'industrial'
                      )),
  budget_min         numeric(14,2),
  budget_max         numeric(14,2),
  budget_currency    text not null default 'PHP',
  target_city        text,
  target_province    text,
  floor_area_sqm_min numeric(10,2),
  lot_area_sqm_min   numeric(10,2),
  storeys            smallint,
  bedrooms           smallint,
  bathrooms          smallint,
  household_adults   smallint,
  household_kids     smallint,
  household_pets     smallint,
  notes              text,

  last_searched_at   timestamptz,
  won_listing_id     uuid references public.listings(id),

  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.inquiries
  add constraint inquiries_promoted_lead_id_fkey
  foreign key (promoted_lead_id) references public.buyer_requirements(id);

-- buyer_requirement_matches: which listings were actually sent as options

create table public.buyer_requirement_matches (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.workspaces(id),
  buyer_requirement_id uuid not null references public.buyer_requirements(id) on delete cascade,
  listing_id           uuid not null references public.listings(id),
  score                numeric(5,2),
  sent_at              timestamptz not null default now(),
  created_by           uuid references auth.users(id),

  unique (buyer_requirement_id, listing_id)
);

create index idx_inquiries_tenant_id on public.inquiries (tenant_id);
create index idx_inquiries_tenant_stage on public.inquiries (tenant_id, stage);
create index idx_buyer_requirements_tenant_id on public.buyer_requirements (tenant_id);
create index idx_buyer_requirements_tenant_stage on public.buyer_requirements (tenant_id, stage);
create index idx_buyer_requirements_contact_id on public.buyer_requirements (contact_id);
create index idx_brm_tenant_id on public.buyer_requirement_matches (tenant_id);
create index idx_brm_buyer_requirement_id on public.buyer_requirement_matches (buyer_requirement_id);

create trigger trg_inquiries_updated_at before update on public.inquiries
  for each row execute function public.set_updated_at();
create trigger trg_buyer_requirements_updated_at before update on public.buyer_requirements
  for each row execute function public.set_updated_at();

-- RLS: mirrors contacts' exact shape (tenant CRUD, admin-only delete)

alter table public.inquiries enable row level security;
alter table public.buyer_requirements enable row level security;
alter table public.buyer_requirement_matches enable row level security;

create policy inquiries_select_tenant on public.inquiries for select
  using (tenant_id = public.current_tenant_id());
create policy inquiries_insert_tenant on public.inquiries for insert
  with check (tenant_id = public.current_tenant_id());
create policy inquiries_update_tenant on public.inquiries for update
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy inquiries_delete_admin on public.inquiries for delete
  using (tenant_id = public.current_tenant_id() and public.current_role() = 'admin');

create policy buyer_requirements_select_tenant on public.buyer_requirements for select
  using (tenant_id = public.current_tenant_id());
create policy buyer_requirements_insert_tenant on public.buyer_requirements for insert
  with check (tenant_id = public.current_tenant_id());
create policy buyer_requirements_update_tenant on public.buyer_requirements for update
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy buyer_requirements_delete_admin on public.buyer_requirements for delete
  using (tenant_id = public.current_tenant_id() and public.current_role() = 'admin');

create policy brm_select_tenant on public.buyer_requirement_matches for select
  using (tenant_id = public.current_tenant_id());
create policy brm_insert_tenant on public.buyer_requirement_matches for insert
  with check (tenant_id = public.current_tenant_id());
create policy brm_delete_tenant on public.buyer_requirement_matches for delete
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.inquiries, public.buyer_requirements to authenticated;
grant select, insert, delete on public.buyer_requirement_matches to authenticated;
grant all on public.inquiries, public.buyer_requirements, public.buyer_requirement_matches to service_role;
