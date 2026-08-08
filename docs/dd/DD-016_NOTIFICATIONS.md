# DD-016 — Notifications

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-08-08
**Last Updated:** 2026-08-08

---

## Purpose

Exact table/column/constraint definitions for `notifications` and the `tasks.reminder_sent_at`
column, as implemented by
`supabase/migrations/20260808130000_notifications_task_due_reminder.sql`
(`tb-notifications-task-due-reminder-001`, TB1 of `cap-notifications-001`). Written same-day per
CLAUDE.md's DS/DD-note requirement (RFC-004), not retroactively.

---

## Scope

Covers `public.notifications` and the one column this tracer bullet added to `public.tasks`
(`reminder_sent_at`). Does **not** cover the rest of the `tasks` table — `public.tasks` itself
has no DD doc of its own (a pre-existing gap this tracer bullet didn't create; `tasks` predates
this convention and was never backfilled the way the ~19 other tables were in the 2026-07-27
birds-eye review). Flagged here rather than silently worked around. Does not cover the
`task-due-reminder-check` Edge Function's logic (TS documentation, not DD) or `workspaces`
(DD-001, the `tenant_id` FK target) / `profiles` (DD-001, the `recipient_id` FK target).

---

## Table: `notifications`

A general, per-recipient (or tenant-wide) notification — task due-date reminders are its first
producer. See `cap-notifications-001` (Theos Registry) for the reusability rationale.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | No `on delete cascade` — differs from the tracer bullet doc's original sketch, which had cascade; the shipped migration omits it. |
| `recipient_id` | `uuid` | nullable, FK → `profiles(id)` | No `on delete cascade`, same note as `tenant_id`. Nullable: `null` means tenant-wide — not yet produced by any consumer as of this migration, but the select policy and read path support it from day one. |
| `type` | `text` | not null | Open string (e.g. `'task_due'`), no enum/CHECK — same wait-and-see posture `cap-tasks-001` took on `task_type`, since the real set of notification-producing consumers isn't known yet. |
| `entity_type` | `text` | nullable | Generic polymorphic link (e.g. `'task'`), no FK by design — mirrors `tasks.entity_type`'s own precedent. |
| `entity_id` | `uuid` | nullable | Paired with `entity_type`, no FK. |
| `title` | `text` | not null | |
| `message` | `text` | not null | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `read_at` | `timestamptz` | nullable | Not yet set by any code path as of this migration — the Notifications tab UI only exercises `dismissed_at`. |
| `dismissed_at` | `timestamptz` | nullable | Set by `POST /notifications/:id/dismiss`. |

Indexes: `idx_notifications_tenant_recipient` on `(tenant_id, recipient_id)`;
`idx_notifications_tenant_undismissed` on `(tenant_id, recipient_id) where dismissed_at is null`.

---

## Row-Level Security

RLS **enabled with real policies read through the scoped client** — the current target
architecture per `tb-platform-rls-scoped-client-001`, not the older
"service-role-only" shortcut `contract_notifications` (DD-001) and `training_sessions` (DD-009)
use.

- `notifications_select_own_or_tenant_wide` (`select`): `tenant_id = (select
  current_tenant_id())` and (`recipient_id = (select auth.uid())` or `recipient_id is null`).
- `notifications_update_own` (`update`, `using` + `with check`): `tenant_id = (select
  current_tenant_id())` and `recipient_id = (select auth.uid())` — dismiss-only in practice,
  since that's the only client-facing write. A tenant-wide notification (`recipient_id is
  null`) can't be dismissed by one member for everyone.

Both policies use the `(select auth.uid())` / `(select current_tenant_id())` wrapped form per
the RLS-performance precedent (`tb-platform-performance-hardening-001`).

Grants: `select, update` to `authenticated`; `all` to `service_role`.

---

## Column added to `tasks`: `reminder_sent_at`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `reminder_sent_at` | `timestamptz` | nullable | Idempotency flag — the due-date reminder email/notification fires at most once per task, set by `task-due-reminder-check`. Reset to `null` if `due_date` is pushed out past the 1-day lead-time window again, so a genuine re-approach re-warns. Same pattern as `workspaces.warning_30d_sent_at` and `listings.authority_warning_7d_sent_at` (DD-001). |

No other column on `tasks` is covered by this doc — see Scope above.

---

## Cron Trigger

`task-due-reminder-daily-check` — daily `pg_cron` job, `0 3 * * *` (03:00 UTC, offset from the
existing three jobs at 01:00/02:00 UTC), `net.http_post`-ing `task-due-reminder-check` with the
existing shared `contract_expiry_cron_secret` Vault secret as bearer. Fourth application of the
same pattern as `contract-expiry-check`, `listing-authority-expiry-check`, and
`training-reminder-check`.

---

## Related Documents

- DD-001 — Workspaces & Profiles (`tenant_id`/`recipient_id` FK targets; `warning_*_sent_at`
  idempotency-flag pattern reused by `reminder_sent_at`; `contract_notifications`' older
  service-role-only RLS shortcut)
- DD-009 — Training Sessions (`training_sessions.reminder_sent_at`, the same idempotency
  pattern applied a second time before this table)
- `cap-notifications-001` / `tb-notifications-task-due-reminder-001` (Theos Registry) — the
  capability and tracer bullet this doc implements
- `cap-tasks-001` (Theos Registry) — owns `tasks.due_date`/`tasks.assignee_id`, the fields this
  table's first producer reads; `tasks` itself has no DD doc (see Scope)
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes (the target pattern this
  table's policies follow)
- `supabase/migrations/20260808130000_notifications_task_due_reminder.sql` — implements this doc

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-08-08 | Initial version, written same-day per CLAUDE.md's DS/DD-note DoD requirement (RFC-004). |
