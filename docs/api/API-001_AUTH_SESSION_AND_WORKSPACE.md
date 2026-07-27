# API-001 — Auth, Session, Workspace Status & Export

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

HTTP contract for health checks, per-request auth guards, workspace/contract status, and
tenant data export. Written from a 2026-07-27 birds-eye review of `application/backend/src/`
— this is a from-scratch API spec; none existed before.

---

## Scope

Covers `GET /health`, `GET/POST /me/*`, `GET /export`, and the three auth-guard middlewares
every other API document assumes. Does not cover any resource's own CRUD routes (see
API-002 through API-006).

---

## Auth Guards

Defined in `application/backend/src/lib/auth.ts`. All three verify the bearer token via
`supabaseAdmin.auth.getUser(token)` plus a `profiles` lookup — no local JWT verification or
caching; every authenticated request costs one round-trip to Supabase Auth plus a DB read.

| Guard | Requires | Notes |
|---|---|---|
| `requireAuth` | Valid session, `profiles.tenant_id` set (non-operator) | Also enforces `workspaces.access_state` (DD-001): `blocked` → 403 on every method; `read_only` → 403 on non-GET methods only |
| `requireOperator` | Valid session, `profiles.role = 'operator'` | `tenant_id` is null for operators — cross-tenant by design |
| `requireMigrationAccess` | Either of the above | Hybrid: an operator must pass `?tenant_id=` explicitly; a non-operator falls through to `requireAuth`'s own session tenant |

All backend routes currently use the service-role Supabase client regardless of guard — see
ADR-002's "Superseded By (partial)" note and ADR-003 for the target architecture (scoped client
for tenant-user-facing routes), not yet implemented.

---

## Routes

| Method | Path | Guard | Request | Response | Notes |
|---|---|---|---|---|---|
| `GET` | `/health` | none | — | `200` if `workspaces` table is reachable | Unauthenticated liveness check |
| `GET` | `/me/workspace-status` | `requireAuth` | — | `{ access_state, contract_end_date, active_warning, notifications: [...] }` | `active_warning` is a derived tier (none/30d/7d/1d) from `workspaces.warning_*_sent_at` (DD-001); `notifications` is undismissed `contract_notifications` rows |
| `POST` | `/me/notifications/:id/dismiss` | `requireAuth` | — | `200` | Sets `contract_notifications.dismissed_at`; scoped to the caller's own tenant |
| `GET` | `/export` | `requireAuth` | — | `application/zip` — `properties.csv` + `contacts.csv` + `listings.csv` | Self-service data export (`cap-client-lifecycle-001`'s offboarding guarantee). Available whenever login itself succeeds (`active` or `read_only` access_state), not restricted to the post-expiry grace window |

---

## Related Documents

- DD-001 — Workspaces & Profiles (`access_state`, `contract_notifications`)
- ADR-002 — Workspace Isolation & Row-Level Security
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `cap-client-lifecycle-001` (Theos Registry) — contract enforcement and export design rationale

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written from a birds-eye technical review — this is a from-scratch API spec, none existed before. |
