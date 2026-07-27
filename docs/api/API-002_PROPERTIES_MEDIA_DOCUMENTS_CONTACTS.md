# API-002 — Properties, Media, Documents & Contacts

**Status:** Draft
**Version:** 1.1.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

HTTP contract for Property CRUD, photo/document sub-resources, and Contacts. Written from a
2026-07-27 birds-eye review — from-scratch API spec.

---

## Scope

Covers `/properties/*` and `/contacts`. Does not cover Listings (API-004), Projects/Units/
Developers (API-003), or Migration (API-005).

---

## Routes: Properties

All require `requireAuth` unless noted. Tenant scoping enforced two ways as of ADR-003's
implementation (`tb-platform-rls-scoped-client-001`): explicit `.eq('tenant_id', ...)` filtering
in every handler, plus RLS underneath via the per-request scoped client (see ADR-002/ADR-003).
Storage upload/remove for property **documents** still use the service-role client (no
`INSERT`/`DELETE` `storage.objects` policy exists yet) — see ADR-003 Decision #4. Property
**media** (photos/videos) no longer touches Storage at all as of
`tb-properties-media-external-links-001` — see Routes: Property Media below.

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `GET` | `/properties` | Query filters | List, each with a `cover_photo_url` (the raw pasted link, not a signed URL) | |
| `POST` | `/properties` | Property fields per DD-002 | Created row | Validates `project_id`/`owner_id` against the caller's own tenant before insert |
| `GET` | `/properties/:id` | — | Single property + joined `project_name` | Route lives in `propertyMedia.ts`, not `listings.ts` where the rest of Property CRUD lives — a file-organization inconsistency, not an API-contract one |
| `PATCH` | `/properties/:id` | Partial property fields | Updated row | Owner (`owner_id`/`owner_type`) change is admin-gated in application code, not by a separate route |
| `PATCH` | `/properties/:id/verification` | `{ verification_status }` | Updated row | Admin-only, enforced in application code (`requireAuth` + role check), not a distinct guard |
| `GET` | `/properties/:id/listings` | — | Full listing history for the property | See API-004 for the Listing shape itself |

## Routes: Property Media (Photos/Videos — external links only)

No Storage of any kind — `tb-properties-media-external-links-001` (2026-07-27) removed the
`property-media` bucket entirely. Every row is a pasted external link (Google Photos or
elsewhere); the backend stores and returns it as-is, no signing.

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `GET` | `/properties/:id/media` | — | List, each row `{ id, property_id, type, external_url, sort_order, is_cover, created_at }` | |
| `POST` | `/properties/:id/media` | JSON `{ url, type? }` (`type`: `'photo'` \| `'video'`, default `'photo'`) | Created row | `400` if `url` isn't a valid `http(s)://` string (DD-008) |
| `PATCH` | `/properties/:id/media/:mediaId` | `{ sort_order?, is_cover? }` | Updated row | |
| `DELETE` | `/properties/:id/media/:mediaId` | — | `{ success: true }` | |

## Routes: Property Documents

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `GET` | `/properties/:id/documents` | — | List, each with a signed URL | |
| `POST` | `/properties/:id/documents` | Multipart upload + `document_type` | Created row | Writes to the `property-documents` Storage bucket (DD-008) |
| `DELETE` | `/properties/:id/documents/:documentId` | — | `204` | No `PATCH` — documents are immutable once uploaded (DD-008); a wrong `document_type` is fixed by delete-and-re-upload |

## Routes: Contacts

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `GET` | `/contacts` | Query filters | List | Thin — no `POST`/`PATCH`/`DELETE` route exists yet; contacts are currently created only via migration import (API-005), not directly through this API |

---

## Related Documents

- DD-002 — Properties, DD-008 — Property Media & Documents, DD-005 — Contacts
- API-001 — Auth guards this document assumes
- ADR-002 — Workspace Isolation & Row-Level Security
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written from a birds-eye technical review — from-scratch API spec. |
| 1.0.1 | 2026-07-27 | Noted ADR-003's scoped-client implementation and the storage-write exception (`tb-platform-rls-scoped-client-001`). |
| 1.1.0 | 2026-07-27 | Property Media routes rewritten for `tb-properties-media-external-links-001`: no Storage, no signed URLs — `POST` takes `{ url, type? }` JSON, every field is a plain pasted link. `cover_photo_url` on `GET /properties` is now the raw link too. Property Documents routes unaffected. |
