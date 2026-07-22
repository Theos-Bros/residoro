-- ============================================================================
-- tb-listings-co-broker-share-001: Cross-brokerage co-broker docket sharing
--
-- Lets a listing broker share a curated, field-selectable "docket" of their
-- own Listing with another individual user's @handle (tb-accounts-handle-001)
-- -- no organizational affiliation required. This is the first feature in
-- this codebase that needs a genuinely cross-tenant read: the recipient's
-- own tenant is never the source listing's tenant.
--
-- Live projection (user decision, 2026-07-23): included_fields only stores
-- WHICH fields to reveal, never a copy of their values -- every read joins
-- straight through to the live listings/properties rows, so a docket always
-- reflects the current state of the source listing. Revocation (also
-- 2026-07-23: immediate hard cutoff) needs no extra mechanism beyond this --
-- GET /listing-dockets/received already filters status = 'active', so a
-- revoked docket disappears from the recipient's next read immediately.
-- ============================================================================

create table if not exists public.listing_dockets (
  id                uuid primary key default gen_random_uuid(),
  source_listing_id uuid not null references public.listings(id),
  source_tenant_id  uuid not null references public.workspaces(id),
  shared_by         uuid not null references public.profiles(id),
  shared_with       uuid not null references public.profiles(id),
  included_fields   jsonb not null,
  status            text not null default 'active' check (status in ('active', 'revoked')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.listing_dockets is
  'tb-listings-co-broker-share-001: a curated, field-selectable share of one '
  'Listing to one specific recipient account, by @handle. included_fields '
  'controls visibility only -- values are always live-projected from the '
  'current listings/properties rows at read time, never snapshotted.';
comment on column public.listing_dockets.included_fields is
  'jsonb array of field names the sharer chose to include, e.g. '
  '["price", "city"]. Validated against a fixed allow-list in the backend '
  '(application/backend/src/routes/dockets.ts) -- not enforced at the DB '
  'layer since the set of shareable fields is an application concern.';

create index if not exists idx_listing_dockets_shared_with on public.listing_dockets (shared_with);
create index if not exists idx_listing_dockets_shared_by on public.listing_dockets (shared_by);
create index if not exists idx_listing_dockets_source_listing_id on public.listing_dockets (source_listing_id);

create trigger trg_listing_dockets_updated_at
  before update on public.listing_dockets
  for each row execute function public.set_updated_at();

alter table public.listing_dockets enable row level security;

-- Identity-scoped, not tenant-scoped -- a docket's whole purpose is to be
-- visible to its recipient regardless of tenant. Mirrors profiles_update_own's
-- existing auth.uid() pattern (20260721120000_platform_foundation.sql) rather
-- than current_tenant_id(), since tenant isolation is not the relevant
-- boundary for this table. Backend enforces the same checks explicitly via
-- supabaseAdmin regardless of these policies -- same defense-in-depth
-- precedent as every other table in this codebase.
create policy listing_dockets_select_participant on public.listing_dockets
  for select
  using (shared_by = auth.uid() or shared_with = auth.uid());

create policy listing_dockets_insert_sharer on public.listing_dockets
  for insert
  with check (shared_by = auth.uid() and source_tenant_id = public.current_tenant_id());

create policy listing_dockets_update_sharer on public.listing_dockets
  for update
  using (shared_by = auth.uid())
  with check (shared_by = auth.uid());

grant select, insert, update on public.listing_dockets to authenticated;
grant all on public.listing_dockets to service_role;
