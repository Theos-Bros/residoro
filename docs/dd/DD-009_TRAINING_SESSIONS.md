# DD-009 — Training Sessions

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Exact table/column/constraint definitions for `training_sessions`, as implemented by
`supabase/migrations/20260722150000_training_sessions.sql` (`tb-client-lifecycle-training-001`).
Written retroactively as part of a 2026-07-27 birds-eye review.

---

## Scope

Covers only the `public.training_sessions` table. Does not cover the daily
`training-reminder-check` Edge Function's logic (TS documentation, not DD) or `workspaces`
(DD-001, the FK target).

---

## Table: `training_sessions`

The two contractual training sessions (2-day each, one month apart) per enrolled client — one
row per `session_number`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `workspace_id` | `uuid` | not null, FK → `workspaces(id)` on delete cascade | |
| `session_number` | `smallint` | not null, `CHECK` in (`1`, `2`) | |
| `scheduled_date` | `date` | not null | Operator-entered — no scheduling/booking UI for finding mutually available times |
| `status` | `text` | not null, default `'scheduled'`, `CHECK` in (`scheduled`, `completed`, `missed`) | |
| `completed_at` | `timestamptz` | nullable | |
| `reminder_sent_at` | `timestamptz` | nullable | Idempotency flag — the 3-day-ahead reminder email fires at most once per session, set by the `training-reminder-check` Edge Function. Reset to null whenever the operator reschedules `scheduled_date`, mirroring `contract_expiry`'s `warning_*_sent_at` pattern (DD-001) |
| `created_at` | `timestamptz` | not null, default `now()` | |

Constraint: `unique (workspace_id, session_number)` — at most one row per session slot per
workspace.

Index: `idx_training_sessions_workspace` on `(workspace_id)`.

Written via `POST`/`PATCH /admin/...` backend routes only — no client (brokerage-side) write
path exists; training is operator-managed.

---

## Row-Level Security

RLS **enabled with no policies, no grants to `anon`/`authenticated`** — same "service-role-only"
posture as `migration_temp_files` (DD-003) and `contract_notifications` (DD-001). Every access
goes through the backend API (operator-only routes); no brokerage-side route ever reads or
writes this table.

---

## Related Documents

- DD-001 — Workspaces & Profiles (`warning_*_sent_at` idempotency-flag pattern reused here)
- `cap-client-lifecycle-001` (Theos Registry) — training as part of the enrollment/onboarding model
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- `supabase/migrations/20260722150000_training_sessions.sql` — implements this doc, including the
  daily `training-reminder-daily-check` pg_cron job

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review. |
