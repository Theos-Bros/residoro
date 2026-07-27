# API-004 — Listings & Docket Sharing

**Status:** Draft
**Version:** 1.0.1
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

All require `requireAuth`, using a per-request client scoped to the caller's JWT (ADR-003,
implemented by `tb-platform-rls-scoped-client-001`) — RLS plus the existing explicit
`.eq('tenant_id', ...)` filters.

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `GET` | `/listings` | Query filters | List | |
| `POST` | `/listings` | Listing fields per DD-006 | Created row | Runs the exclusivity conflict check on creation if `status` is set directly to `active` |
| `PATCH` | `/listings/:id` | `{ status?, ... }` | Updated row | Status-transition legality enforced in application code (DD-006). Activating a listing that conflicts with an existing active exclusive listing on the same property either returns a soft warning in the response or a hard `409`, depending on the workspace's `exclusivity_hard_block` setting (DD-001) |

## Routes: Listing Dockets

`listing_dockets` itself is identity-scoped RLS (`shared_by`/`shared_with = auth.uid()`, DD-006)
and its own reads/writes use the scoped client. But the recipient-handle lookup, the sharer-handle
lookup, and the joined listing/property data for `GET /listing-dockets/received` are genuinely
cross-tenant BY DESIGN (the whole point of this feature) and stay on the service-role client —
`properties_select_tenant` / `listings_select_tenant` / `profiles_select_same_tenant` would
otherwise silently block them for the recipient. See ADR-003 Decision #4 and the file-level
comment in `application/backend/src/routes/dockets.ts`.

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `POST` | `/listing-dockets` | `{ source_listing_id, shared_with_handle, included_fields }` | Created row | Resolves `shared_with_handle` (a `@handle`, DD-001) to a `profiles.id` server-side, via the service-role client (cross-tenant lookup) |
| `GET` | `/listing-dockets/received` | — | List of active dockets shared with the caller | Cross-tenant read — the one route in this API where the response can include another tenant's listing data. The docket row query itself is scoped-client + RLS; the joined listing/property data and sharer handles are fetched separately via the service-role client (see note above) |
| `PATCH` | `/listing-dockets/:id` | `{ status: 'revoked' }` | Updated row | Only the sharer (`shared_by`) can revoke; revocation is immediate (the received-dockets query filters `status = 'active'`) |

---

## Related Documents

- DD-006 — Listings & Docket Sharing
- DD-001 — Workspaces & Profiles (`handle`, `exclusivity_hard_block`)
- API-001 — Auth guards this document assumes
- API-002 — Properties (the entity a Listing markets)
- ADR-002 — Workspace Isolation & Row-Level Security
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written from a birds-eye technical review — from-scratch API spec. |
| 1.0.1 | 2026-07-27 | Documented ADR-003's scoped-client implementation and dockets.ts's per-query exceptions for the genuinely cross-tenant reads (`tb-platform-rls-scoped-client-001`). |
