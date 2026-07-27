# API-003 — Projects, Unit Types & Developers

**Status:** Draft
**Version:** 1.0.1
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

HTTP contract for the developer/pre-selling inventory hierarchy. Written from a 2026-07-27
birds-eye review — from-scratch API spec.

---

## Scope

Covers `/developers`, `/projects/*`. Does not cover Property itself (API-002).

---

## Routes: Developers

All require `requireAuth`, using a per-request client scoped to the caller's JWT (ADR-003,
implemented by `tb-platform-rls-scoped-client-001`) — RLS plus the existing explicit
`.eq('tenant_id', ...)` filters.

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `GET` | `/developers` | — | List | |
| `POST` | `/developers` | `{ name, contact_info? }` | Created row | No `PATCH`/`DELETE` route |

## Routes: Projects

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `GET` | `/projects` | — | List | |
| `POST` | `/projects` | Project fields per DD-007 | Created row | |
| `GET` | `/projects/:id` | — | Single project | |
| `PATCH` | `/projects/:id` | Partial project fields | Updated row | |

## Routes: Project Unit Types

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `GET` | `/projects/:id/unit-types` | — | List | |
| `POST` | `/projects/:id/unit-types` | Unit-type template fields per DD-007 | Created row | Create-only — no `PATCH` route (DS-007: a wrong template is fixed by creating a new one, not editing) |
| `POST` | `/projects/:id/unit-types/:unitTypeId/generate-units` | `{ count }` | Created `properties` rows | Bulk unit generation — stamps the template out as ordinary `properties` rows, each linked via `unit_type_id` |
| `DELETE` | `/projects/:id/unit-types/:unitTypeId/units` | — | `{ deleted_count }` | Admin-only, enforced in application code. Bulk-removes generated units for a unit type |
| `GET` | `/projects/:id/units-summary` | — | Computed rollup (unit counts by type/status) | No caching — recomputed on every read |

---

## Related Documents

- DD-007 — Developers & Projects
- DD-002 — Properties (`unit_type_id`, `unit_number`)
- API-001 — Auth guards this document assumes
- API-002 — Properties (the entity bulk unit generation writes into)
- ADR-002 — Workspace Isolation & Row-Level Security
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written from a birds-eye technical review — from-scratch API spec. |
| 1.0.1 | 2026-07-27 | Noted ADR-003's scoped-client implementation (`tb-platform-rls-scoped-client-001`). |
