# API-002 — Properties, Media, Documents & Contacts

**Status:** Draft
**Version:** 1.0.1
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
Storage upload/remove for property media/documents still use the service-role client (no
`INSERT`/`DELETE` `storage.objects` policy exists yet) — see ADR-003 Decision #4.

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `GET` | `/properties` | Query filters | List, each with a signed cover-photo URL | |
| `POST` | `/properties` | Property fields per DD-002 | Created row | Validates `project_id`/`owner_id` against the caller's own tenant before insert |
| `GET` | `/properties/:id` | — | Single property + joined `project_name` | Route lives in `propertyMedia.ts`, not `listings.ts` where the rest of Property CRUD lives — a file-organization inconsistency, not an API-contract one |
| `PATCH` | `/properties/:id` | Partial property fields | Updated row | Owner (`owner_id`/`owner_type`) change is admin-gated in application code, not by a separate route |
| `PATCH` | `/properties/:id/verification` | `{ verification_status }` | Updated row | Admin-only, enforced in application code (`requireAuth` + role check), not a distinct guard |
| `GET` | `/properties/:id/listings` | — | Full listing history for the property | See API-004 for the Listing shape itself |

## Routes: Property Media (Photos)

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `GET` | `/properties/:id/media` | — | List, each with a signed URL | |
| `POST` | `/properties/:id/media` | Multipart upload | Created row | Writes to the `property-media` Storage bucket (DD-008) |
| `PATCH` | `/properties/:id/media/:mediaId` | `{ sort_order?, is_cover? }` | Updated row | |
| `DELETE` | `/properties/:id/media/:mediaId` | — | `204` | |

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
