# API-004 — Listings & Docket Sharing

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

HTTP contract for Listing CRUD and cross-brokerage docket sharing. Written from a 2026-07-27
birds-eye review — from-scratch API spec.

---

## Scope

Covers `/listings`, `/listing-dockets/*`. Does not cover Property itself (API-002).

---

## Routes: Listings

All require `requireAuth`.

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `GET` | `/listings` | Query filters | List | |
| `POST` | `/listings` | Listing fields per DD-006 | Created row | Runs the exclusivity conflict check on creation if `status` is set directly to `active` |
| `PATCH` | `/listings/:id` | `{ status?, ... }` | Updated row | Status-transition legality enforced in application code (DD-006). Activating a listing that conflicts with an existing active exclusive listing on the same property either returns a soft warning in the response or a hard `409`, depending on the workspace's `exclusivity_hard_block` setting (DD-001) |

## Routes: Listing Dockets

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `POST` | `/listing-dockets` | `{ source_listing_id, shared_with_handle, included_fields }` | Created row | Resolves `shared_with_handle` (a `@handle`, DD-001) to a `profiles.id` server-side |
| `GET` | `/listing-dockets/received` | — | List of active dockets shared with the caller | Cross-tenant read — the one route in this API where the response can include another tenant's listing data, gated by `listing_dockets`'s identity-scoped RLS (DD-006) |
| `PATCH` | `/listing-dockets/:id` | `{ status: 'revoked' }` | Updated row | Only the sharer (`shared_by`) can revoke; revocation is immediate (the received-dockets query filters `status = 'active'`) |

---

## Related Documents

- DD-006 — Listings & Docket Sharing
- DD-001 — Workspaces & Profiles (`handle`, `exclusivity_hard_block`)
- API-001 — Auth guards this document assumes
- API-002 — Properties (the entity a Listing markets)
- ADR-002 — Workspace Isolation & Row-Level Security

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written from a birds-eye technical review — from-scratch API spec. |
