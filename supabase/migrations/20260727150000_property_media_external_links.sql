-- ============================================================================
-- Migration: Property Media -> External Links (Photos & Videos)
-- Implements: tb-properties-media-external-links-001 (theos-registry)
-- Supersedes 20260726130000_property_media.sql's Storage-hosting design.
-- Residoro will not host photo/video files at all -- users paste an existing
-- external link (Google Photos or elsewhere) instead of uploading. This
-- removes the property-media Storage bucket entirely and repoints
-- property_media at a plain URL column. Pre-launch, no real client data, so
-- this is a clean cutover -- no backfill of existing rows/objects.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DROP STORAGE POLICY
--    Reverses 20260726130000_property_media.sql's RLS statement.
--    property-documents' bucket/policy is untouched -- documents stay
--    Storage-hosted, only photos/videos are moving to external links.
--    The bucket itself (and any objects in it) can't be dropped via SQL --
--    Supabase blocks direct DML on storage.objects/storage.buckets outside
--    the Storage API -- see scripts/remove-property-media-bucket.ts, run
--    once via the Storage API instead.
-- ----------------------------------------------------------------------------
drop policy if exists property_media_storage_select on storage.objects;

-- ----------------------------------------------------------------------------
-- 2. PROPERTY_MEDIA TABLE: storage_path -> external_url
--    Clean cutover -- existing rows are dropped outright, not migrated,
--    since no real client data exists yet (no Storage object survives the
--    bucket deletion above for them to point at anyway).
-- ----------------------------------------------------------------------------
delete from public.property_media;

alter table public.property_media drop column storage_path;
alter table public.property_media add column external_url text not null;

alter table public.property_media drop constraint if exists property_media_type_check;
alter table public.property_media add constraint property_media_type_check check (type in ('photo', 'video'));

comment on column public.property_media.external_url is
  'A pasted external link (Google Photos or elsewhere) -- Residoro does not '
  'host the file itself. Link-out only, no embed/preview attempted.';
comment on column public.property_media.type is
  'photo or video -- both are just links now, so no MIME/upload distinction '
  'applies (tb-properties-media-external-links-001).';
