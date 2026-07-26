-- ============================================================================
-- Migration: Property Media (Photos)
-- Implements: tb-properties-photos-001 (theos-registry)
-- Introduces Supabase Storage to residoro for the first time -- the CSV
-- migration flow deliberately stores raw_content as text in Postgres
-- instead (see migration_temp_files' own comment); that pattern doesn't
-- transfer to binary images, so this is a new mechanism, not a reuse.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. STORAGE BUCKET
--    Private (not public) -- the frontend reads photos via short-lived
--    signed URLs the backend generates with the service-role key, matching
--    this app's existing tenant-isolation posture instead of a
--    public-internet-readable bucket.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('property-media', 'property-media', false)
on conflict (id) do nothing;

-- All actual reads/writes go through the backend's service-role client
-- (supabaseAdmin), which bypasses Storage RLS entirely -- this select policy
-- is defense-in-depth only, in case a future direct-client path is added, not
-- something the current app relies on. Path convention is
-- "{tenant_id}/{property_id}/{uuid}.{ext}", so (storage.foldername(name))[1]
-- is the tenant_id segment.
create policy property_media_storage_select on storage.objects
  for select
  using (
    bucket_id = 'property-media'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

-- ----------------------------------------------------------------------------
-- 2. PROPERTY_MEDIA TABLE
--    `type` is a single-value check constraint for now, deliberately --
--    widening it to floor_plan|video is a follow-up tracer bullet's job, not
--    this one's (see tb-properties-photos-001 semantic_scope).
-- ----------------------------------------------------------------------------
create table if not exists public.property_media (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.workspaces(id),
  property_id   uuid not null references public.properties(id) on delete cascade,
  type          text not null default 'photo' check (type = 'photo'),
  storage_path  text not null,
  sort_order    integer not null default 0,
  is_cover      boolean not null default false,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

comment on column public.property_media.type is
  'Single-value check constraint deliberately -- widening to floor_plan|video '
  'is a follow-up tracer bullet''s job, not tb-properties-photos-001''s.';
comment on column public.property_media.storage_path is
  'Path within the property-media Storage bucket, not a public URL -- the '
  'backend generates a short-lived signed URL from this on every read.';

create index if not exists idx_property_media_property_id on public.property_media (property_id);

alter table public.property_media enable row level security;

create policy property_media_select_tenant on public.property_media
  for select
  using (tenant_id = public.current_tenant_id());

create policy property_media_insert_tenant on public.property_media
  for insert
  with check (tenant_id = public.current_tenant_id());

create policy property_media_update_tenant on public.property_media
  for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy property_media_delete_tenant on public.property_media
  for delete
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.property_media to authenticated;
grant all on public.property_media to service_role;
