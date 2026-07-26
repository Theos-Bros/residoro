-- ============================================================================
-- Migration: Property Documents (Title, Tax Declaration)
-- Implements: tb-properties-documents-001 (theos-registry)
-- Separate bucket and table from property_media (tb-properties-photos-001) --
-- documents have no cover/sort_order/gallery concept, and a resolved
-- access-sensitivity decision (tenant-wide, same as photos) is what this
-- tracer bullet exists to make real, not to inherit implicitly by reusing
-- property_media's table.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. STORAGE BUCKET
--    Private, tenant-scoped select policy -- exact mirror of property-media's
--    pattern. All writes/deletes go through the backend's service-role
--    client (supabaseAdmin), which bypasses Storage RLS entirely; this
--    select policy is defense-in-depth only.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('property-documents', 'property-documents', false)
on conflict (id) do nothing;

create policy property_documents_storage_select on storage.objects
  for select
  using (
    bucket_id = 'property-documents'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

-- ----------------------------------------------------------------------------
-- 2. PROPERTY_DOCUMENTS TABLE
--    No sort_order/is_cover (photo-gallery-specific, don't apply to a flat
--    document list) and no update policy -- nothing about an uploaded
--    document is mutable after the fact; a wrong document_type is fixed by
--    delete-and-re-upload.
-- ----------------------------------------------------------------------------
create table if not exists public.property_documents (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.workspaces(id),
  property_id    uuid not null references public.properties(id) on delete cascade,
  document_type  text not null check (document_type in ('title_deed', 'tax_declaration', 'other')),
  storage_path   text not null,
  file_name      text not null,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);

comment on column public.property_documents.storage_path is
  'Path within the property-documents Storage bucket, not a public URL -- '
  'the backend generates a short-lived signed URL from this on every read.';
comment on column public.property_documents.file_name is
  'Original uploaded filename -- documents are listed individually by name, '
  'unlike photos which render as an unlabeled thumbnail grid.';

create index if not exists idx_property_documents_property_id on public.property_documents (property_id);

alter table public.property_documents enable row level security;

-- Resolved 2026-07-26: tenant-wide access, same RLS pattern as property_media
-- (any authenticated user in the tenant can view/download, not just the
-- uploader or admins) -- see tb-properties-documents-001 Context.
create policy property_documents_select_tenant on public.property_documents
  for select
  using (tenant_id = public.current_tenant_id());

create policy property_documents_insert_tenant on public.property_documents
  for insert
  with check (tenant_id = public.current_tenant_id());

create policy property_documents_delete_tenant on public.property_documents
  for delete
  using (tenant_id = public.current_tenant_id());

grant select, insert, delete on public.property_documents to authenticated;
grant all on public.property_documents to service_role;
