# API-006 — Admin & Client Lifecycle

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

HTTP contract for operator-only routes: client enrollment, workspace policy configuration, and
training tracking. Written from a 2026-07-27 birds-eye review — from-scratch API spec.

---

## Scope

Covers `/admin/*`. Does not cover migration execution itself (API-005, though it's also
operator-triggered) or the workspace-status routes a brokerage's own users hit (API-001).

---

## Auth

All routes require `requireOperator` (API-001) — platform-wide, cross-tenant, `tenant_id`
null on the caller's own profile.

---

## Routes

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `GET` | `/admin/whoami` | — | `{ role: 'operator', ... }` | Used by the frontend to distinguish an operator session from a brokerage session (`useOperatorStatus`) |
| `POST` | `/admin/clients` | `{ workspace_name, admin_email, contract_start_date, contract_end_date }` | Created `workspaces` row | Creates the workspace and invites its first admin via `auth.admin.inviteUserByEmail` — the enrollment path (DS-001's "Key Decision", resolved) |
| `GET` | `/admin/clients` | — | List, each with a derived `invite_status` | `invite_status` derived from `email_confirmed_at`, not a stored column |
| `PATCH` | `/admin/clients/:id` | `{ contract_end_date }` | Updated row | Contract renewal — resets `access_state` and warning flags (DD-001) if the new date is far enough out |
| `PATCH` | `/admin/clients/:id/listings-policy` | `{ exclusivity_hard_block }` | Updated row | |
| `PATCH` | `/admin/clients/:id/rollback-policy` | `{ rollback_window_hours }` | Updated row | Only affects batches created after this change — not retroactive (DD-001) |
| `POST` | `/admin/clients/:id/training` | `{ session_1_date, session_2_date }` | Created `training_sessions` rows | Upserts both contractual training sessions at once |
| `PATCH` | `/admin/training/:id` | `{ status: 'completed' \| 'missed' }` | Updated row | |
| `GET` | `/admin/training` | `?status=upcoming\|overdue` | Cross-client list | Single view across every enrolled client, not scoped to one workspace |

---

## Related Documents

- DD-001 — Workspaces & Profiles, DD-009 — Training Sessions
- DS-006 — Client Lifecycle Operations
- API-001 — Auth guards this document assumes (`requireOperator`)
- API-005 — Migration Pipeline (the other operator-run flow, gated by `requireMigrationAccess` instead)
- `cap-client-lifecycle-001` (Theos Registry) — invite-only, contract-based enrollment model

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written from a birds-eye technical review — from-scratch API spec. |
