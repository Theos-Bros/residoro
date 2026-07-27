# DD-008 — Property Media & Documents

**Status:** Draft
**Version:** 1.1.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Exact table/column/constraint definitions for `property_media` and `property_documents`, plus
the two Supabase Storage buckets they reference. Written retroactively as part of a 2026-07-27
birds-eye review.

---

## Scope

Covers `public.property_media`, `public.property_documents`, and the `property-media` /
`property-documents` Storage buckets. Does not cover `properties` (DD-002) itself.

---

## Storage Buckets

**`property-media` was removed by `tb-properties-media-external-links-001` (2026-07-27).**
Residoro does not host property photos/videos at all anymore — users paste an existing external
link (Google Photos or elsewhere) instead of uploading a file. The bucket, its `storage.objects`
policy, and every `storage_path`/signed-URL code path were deleted; `property_media` now stores
a plain `external_url` column instead (see table below). `property-documents` is **unaffected** —
documents (title deed, tax declaration) stay Storage-hosted, since the 2026-07-27 decision was
photos/videos only.

| Bucket | Path convention | Notes |
|---|---|---|
| `property-documents` | `{tenant_id}/{property_id}/{uuid}.{ext}` | Added by `tb-properties-documents-001`. Private (`public = false`); the backend generates short-lived signed URLs with the service-role key on every read. |

The bucket has one `storage.objects` `select` policy (`property_documents_storage_select`)
checking `(storage.foldername(name))[1] = current_tenant_id()::text`. **This is defense-in-depth
only** — all actual reads/writes go through the backend's service-role client, which bypasses
Storage RLS entirely; nothing in the current app relies on this policy being the enforcement
path.

## Table: `property_media`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `property_id` | `uuid` | not null, FK → `properties(id)` on delete cascade | |
| `type` | `text` | not null, default `'photo'`, `CHECK (type in ('photo', 'video'))` | Widened from a single-value `'photo'` constraint by `tb-properties-media-external-links-001` — trivial once nothing is uploaded/MIME-validated, a link doesn't care whether it points at a photo or a video |
| `external_url` | `text` | not null | A pasted external link (Google Photos or elsewhere) — Residoro does not host the file. Link-out only, no embed/preview. Replaces `storage_path`, removed by `tb-properties-media-external-links-001` |
| `sort_order` | `integer` | not null, default `0` | Gallery ordering |
| `is_cover` | `boolean` | not null, default `false` | |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | |

Index: `idx_property_media_property_id` on `(property_id)`.

## Table: `property_documents`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `property_id` | `uuid` | not null, FK → `properties(id)` on delete cascade | |
| `document_type` | `text` | not null, `CHECK` in (`title_deed`, `tax_declaration`, `other`) | |
| `storage_path` | `text` | not null | Path within the `property-documents` bucket |
| `file_name` | `text` | not null | Original uploaded filename — documents are listed individually by name, unlike photos which render as an unlabeled thumbnail grid |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | |

Index: `idx_property_documents_property_id` on `(property_id)`.

**No `sort_order`/`is_cover`** (photo-gallery-specific concepts, don't apply to a flat document
list) **and no `update` route/policy** — nothing about an uploaded document is mutable after the
fact; a wrong `document_type` is fixed by delete-and-re-upload, not an edit.

---

## Row-Level Security

Both tables: tenant-scoped, **resolved 2026-07-26 as tenant-wide access** (any authenticated
user in the tenant can view/download, not just the uploader or admins — see
`tb-properties-documents-001` Context).

| Table | Policy | Rule |
|---|---|---|
| `property_media` | `property_media_select_tenant` | `select` where `tenant_id = current_tenant_id()` |
| `property_media` | `property_media_insert_tenant` | `insert` with check `tenant_id = current_tenant_id()` |
| `property_media` | `property_media_update_tenant` | `update` where/with check `tenant_id = current_tenant_id()` |
| `property_media` | `property_media_delete_tenant` | `delete` where `tenant_id = current_tenant_id()` |
| `property_documents` | `property_documents_select_tenant` | `select` where `tenant_id = current_tenant_id()` |
| `property_documents` | `property_documents_insert_tenant` | `insert` with check `tenant_id = current_tenant_id()` |
| `property_documents` | `property_documents_delete_tenant` | `delete` where `tenant_id = current_tenant_id()` |

Note `property_media` has an `_delete_tenant` policy (any tenant member can delete) rather than
the `_delete_admin` pattern `properties`/`developers`/`projects` use (admin-only) — a deliberate
looser rule for photos, not an inconsistency to fix. `property_documents` has no `update` policy
at all, matching the no-update-route decision above.

`authenticated` granted `select, insert, update, delete` on `property_media`; `select, insert,
delete` (no `update`) on `property_documents`. `service_role` has full access on both — as with
every other table, the backend currently uses `service_role` for all routes (see ADR-002's
"Superseded By (partial)" note and ADR-003).

---

## Related Documents

- DD-002 — Properties (the entity these attach to)
- `cap-properties-001` (Theos Registry) — PropertyMedia/PropertyDocument design rationale
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260726130000_property_media.sql` — original `property_media` + bucket (superseded)
- `supabase/migrations/20260727150000_property_media_external_links.sql` — removes the bucket, repoints `property_media` at `external_url`
- `supabase/migrations/20260727100000_property_documents.sql` — implements `property_documents` and its bucket (unaffected)

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.1.0 | 2026-07-27 | `tb-properties-media-external-links-001`: removed the `property-media` Storage bucket entirely; `property_media.storage_path` replaced with `external_url`; `type` widened to `photo`\|`video`. `property_documents`/`property-documents` unaffected. |
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review covering two already-shipped tracer bullets. |
