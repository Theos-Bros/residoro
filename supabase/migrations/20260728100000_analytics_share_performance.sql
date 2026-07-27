-- ============================================================================
-- Migration: Analytics -- Share Event Tracking + Hot Threshold
-- Implements: tb-analytics-share-performance-001 (theos-registry)
-- Logs each successful share-text copy (tb-distribution-share-text-001) as a
-- row, and adds a per-workspace configurable threshold for what counts as
-- "Hot". Best-effort telemetry only -- see the tracer bullet's Context for
-- why this is deliberately not a tamper-proof audit trail.
-- ============================================================================

create table if not exists public.listing_share_events (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  tenant_id   uuid not null references public.workspaces(id),
  audience    text not null check (audience in ('public', 'co_broker', 'internal')),
  shared_by   uuid not null references auth.users(id),
  created_at  timestamptz not null default now()
);

comment on table public.listing_share_events is
  'One row per successful clipboard copy from ShareDetailsModal '
  '(tb-distribution-share-text-001). Client-triggered, not enforced -- a '
  'manual select+copy in the rendered text bypasses this entirely. Best-effort '
  'usage telemetry for the Performance page, not an audit trail.';

create index if not exists idx_listing_share_events_listing_id
  on public.listing_share_events (listing_id);
create index if not exists idx_listing_share_events_tenant_created
  on public.listing_share_events (tenant_id, created_at);

alter table public.listing_share_events enable row level security;

-- Same tenant-wide read/write pattern as property_documents/property_media --
-- any authenticated tenant member can log and view their own workspace's
-- share events, not just admins or the sharer themselves.
create policy listing_share_events_select_tenant on public.listing_share_events
  for select
  using (tenant_id = public.current_tenant_id());

create policy listing_share_events_insert_tenant on public.listing_share_events
  for insert
  with check (tenant_id = public.current_tenant_id());

grant select, insert on public.listing_share_events to authenticated;
grant all on public.listing_share_events to service_role;

alter table public.workspaces
  add column if not exists hot_share_threshold integer not null default 3;

comment on column public.workspaces.hot_share_threshold is
  'Per-brokerage share-count threshold (trailing 30 days) at or above which '
  'a listing is flagged "Hot" on the Performance page '
  '(tb-analytics-share-performance-001). Admin-editable via '
  'Settings -> Performance; the 30-day window itself is a fixed application '
  'constant, not configurable. Governed by the existing workspaces_update_admin '
  'RLS policy, same as public_share_template/co_broker_share_template.';
