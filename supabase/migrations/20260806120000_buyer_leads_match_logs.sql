-- ============================================================================
-- Migration: Buyer Lead Match Logs -- persisted "I matched/showed these" record
-- Implements: tb-buyer-leads-match-itinerary-001 (theos-registry)
--
-- Deliberately a NEW table pair, not a reuse of buyer_requirement_matches
-- (20260728160000_buyer_leads_schema.sql). buyer_requirement_matches already
-- has an owner: it's the options-sent stage-transition record (unique per
-- listing_id, one row inserted per POST /buyer-requirements/:id/options-sent,
-- always a real listings.id). This tracer bullet's match log is a different
-- concept per its own semantic_scope: many-per-lead, purely informational,
-- never a precondition/substitute for anything, and each item can be EITHER
-- a listing_id (inventory- or docket-sourced) OR a property_id (an unlisted
-- project unit, per tb-buyer-leads-matching-project-units-001's MatchResult
-- shape, where a project_unit result's "listing_id" field actually holds a
-- properties.id). buyer_requirement_matches has no property_id column and a
-- NOT NULL listing_id -- it cannot represent a project-unit match without
-- breaking its own existing options-sent contract, so widening it was
-- rejected in favor of this parallel table.
--
-- One "log match" action = one buyer_requirement_match_logs row (the event:
-- who, when) + N buyer_requirement_match_log_items rows (what was matched).
-- ============================================================================

create table public.buyer_requirement_match_logs (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.workspaces(id) on delete cascade,
  buyer_requirement_id  uuid not null references public.buyer_requirements(id) on delete cascade,
  logged_by             uuid references auth.users(id),
  created_at            timestamptz not null default now()
);

create table public.buyer_requirement_match_log_items (
  id            uuid primary key default gen_random_uuid(),
  match_log_id  uuid not null references public.buyer_requirement_match_logs(id) on delete cascade,
  listing_id    uuid references public.listings(id),
  property_id   uuid references public.properties(id),
  constraint match_log_item_has_one_target
    check ((listing_id is not null) <> (property_id is not null))
);

comment on table public.buyer_requirement_match_logs is
  'tb-buyer-leads-match-itinerary-001: one row per "Log match" action on a '
  'Lead -- many per buyer_requirement, purely informational, distinct from '
  'buyer_requirement_matches (the options-sent stage-transition record) and '
  'never coupled to tb-transactions-offers-001''s 1:1 offer.';
comment on table public.buyer_requirement_match_log_items is
  'The matched items for one match log entry. Exactly one of listing_id / '
  'property_id is set per row -- property_id covers project-linked units '
  'that have no Listing yet (tb-buyer-leads-matching-project-units-001).';

create index idx_brml_tenant_id on public.buyer_requirement_match_logs (tenant_id);
create index idx_brml_buyer_requirement_id on public.buyer_requirement_match_logs (buyer_requirement_id);
create index idx_brmli_match_log_id on public.buyer_requirement_match_log_items (match_log_id);
create index idx_brmli_listing_id on public.buyer_requirement_match_log_items (listing_id);
create index idx_brmli_property_id on public.buyer_requirement_match_log_items (property_id);

-- RLS: same tenant-scoped, whole-brokerage-visible pattern as
-- buyer_requirement_matches -- cap-buyer-leads-001 has no agent-assignment
-- concept, so there's no per-agent restriction here either. Uses the
-- (select public.current_tenant_id()) wrapper directly (not the bare-call
-- form 20260728160000 originally shipped with) -- 20260728190000 already
-- established that as this area's correct, perf-aligned idiom, so new
-- tables should start on it rather than needing their own follow-up
-- alignment migration.
alter table public.buyer_requirement_match_logs enable row level security;
alter table public.buyer_requirement_match_log_items enable row level security;

create policy brml_select_tenant on public.buyer_requirement_match_logs for select
  using (tenant_id = (select public.current_tenant_id()));
create policy brml_insert_tenant on public.buyer_requirement_match_logs for insert
  with check (tenant_id = (select public.current_tenant_id()));
-- No update/delete policy: a logged match is an immutable, append-only
-- history entry (mirrors how brm_* never got an update policy either) --
-- deletable only via the on delete cascade from its parent buyer_requirement
-- or workspace, never directly.

-- Item rows have no tenant_id of their own (they're never queried directly
-- by tenant, only ever through their parent match log) -- RLS instead joins
-- to the parent row's already-tenant-checked policy.
create policy brmli_select_tenant on public.buyer_requirement_match_log_items for select
  using (exists (
    select 1 from public.buyer_requirement_match_logs l
    where l.id = match_log_id and l.tenant_id = (select public.current_tenant_id())
  ));
create policy brmli_insert_tenant on public.buyer_requirement_match_log_items for insert
  with check (exists (
    select 1 from public.buyer_requirement_match_logs l
    where l.id = match_log_id and l.tenant_id = (select public.current_tenant_id())
  ));

grant select, insert on public.buyer_requirement_match_logs, public.buyer_requirement_match_log_items to authenticated;
grant all on public.buyer_requirement_match_logs, public.buyer_requirement_match_log_items to service_role;
