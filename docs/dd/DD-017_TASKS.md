# DD-017 — Tasks

**Status:** Draft
**Version:** 1.1.0
**Owner:** Residoro Engineering
**Created:** 2026-08-09
**Last Updated:** 2026-08-10

---

## Purpose

Exact table/column/constraint definitions for `tasks` and `workspace_task_routing_settings`, as
implemented across four migrations from `tb-tasks-crud-001` (2026-07-28) through
`tb-search-core-entities-001` (2026-08-08). Written retroactively — this domain shipped with zero
DD coverage, caught by a 2026-08-09 birds-eye audit (see RFC-004 on why this keeps recurring and
the per-tracer-bullet DoD requirement meant to close it going forward).

---

## Scope

Covers `public.tasks` and `public.workspace_task_routing_settings` only. Does not cover
`settings_edit_delegations` (DD-020) or the specific `task_type` values other capabilities emit
into this table (`cap-buyer-leads-001`'s stage-change tasks, `cap-notifications-001`'s due-date
reminders) — those are consumers of this schema, not part of it.

---

## Table: `tasks`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `title` | `text` | not null | |
| `description` | `text` | nullable | |
| `status` | `text` | not null, default `'open'`, `CHECK` in (`open`, `in_progress`, `done`) | |
| `due_date` | `date` | nullable | |
| `assignee_id` | `uuid` | nullable, FK → `profiles(id)` | |
| `entity_type` | `text` | nullable | Generic polymorphic link (e.g. `'buyer_requirement'`) — deliberately no FK, `cap-tasks-001` Decision #2, so any future entity can be linked without a schema change here. Null for a standalone task |
| `entity_id` | `uuid` | nullable | Paired with `entity_type`; same no-FK rationale |
| `task_type` | `text` | not null, default `'manual'` | Open text, not a `CHECK`-constrained enum — new task types are added by whichever capability emits them, not centrally |
| `reminder_sent_at` | `timestamptz` | nullable | Added by `tb-notifications-task-due-reminder-001` (2026-08-08) — idempotency flag so the due-date-reminder cron job doesn't re-notify the same task twice, same precedent as other idempotency-flag columns elsewhere in the schema |
| `search_vector` | `tsvector` | generated always as, stored | Added by `tb-search-core-entities-001` (2026-08-08). `to_tsvector(title)` only — no secondary-weighted field |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()`, trigger-maintained | **Note:** the `set_updated_at()` trigger wiring was itself missing for 11 days (`20260728200000` created the column with a default but no trigger; `20260808160000` added the trigger) — an oversight, not a deliberate v1 gap. Found live: `TasksPage.tsx`'s "Completed This Week" stat filters on `status = 'done' AND updated_at` within 7 days, so a task older than a week that got marked done silently never counted until the trigger was added |

Indexes: `idx_tasks_tenant_id` on `(tenant_id)`, `idx_tasks_entity` on `(entity_type, entity_id)`,
`idx_tasks_assignee` on `(assignee_id)`, `idx_tasks_search_vector` (GIN, on `search_vector`).

---

## Table: `workspace_task_routing_settings`

Per-`(tenant, task_type)` default-assignee routing config. One row per configured `task_type`;
an absent row means "no default, falls back to unassigned" — opt-in coverage, not mandatory.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)`, part of composite PK | |
| `task_type` | `text` | not null, part of composite PK `(tenant_id, task_type)` | |
| `default_assignee_id` | `uuid` | nullable, FK → `profiles(id)` | Routes to one specific person |
| `assignee_role` | `text` | nullable, `CHECK` in (`'admin'`) | Added by `tb-buyer-leads-stage-tasks-001` (2026-07-28) — routes to "whoever holds the tenant's admin role" instead of one hardcoded person. Scoped to `'admin'` only (`profiles.role` is `admin`/`member`, and "member" doesn't name one deterministic destination); resolution is unambiguous because `tb-brokerage-permissions-admin-uniqueness-001` guarantees exactly one admin-role profile per tenant |

**Constraint:** `workspace_task_routing_settings_assignee_xor` — at most one of
`default_assignee_id`/`assignee_role` may be set at a time; both null means "no default
configured."

---

## Row-Level Security

**`tasks`:** standard tenant-scoped CRUD, matching `contacts`/`properties`'s pattern exactly —
`tasks_select_tenant`/`_insert_tenant`/`_update_tenant` (all `current_tenant_id()`-scoped),
`tasks_delete_admin` (admin-only). `authenticated` granted `select, insert, update, delete`;
`service_role` full access.

**`workspace_task_routing_settings`:** follows this codebase's per-setting delegated-write
pattern (same shape as `workspace_matching_settings`) — `task_routing_select_tenant` (any tenant
member can view), `task_routing_write_delegated` (write requires
`has_settings_delegation('tasks')`, the delegation flag added to `settings_edit_delegations`'
`setting_key` `CHECK` list by this same migration).

**Correction (2026-08-10, `tb-platform-grant-lockdown-001`):** neither table's actual grant
matched what's described above. `tasks`' `select, insert, update, delete` verb claim was right
but table-wide, not column-scoped, and `anon` held the identical default; closed via
`supabase/migrations/20260810240000_tier1_grant_lockdown.sql` (`select` all columns + `insert`/
`update` narrowed to exactly the columns `routes/tasks.ts` writes, full `delete`).
`workspace_task_routing_settings`' actual grant was never stated here — it too held the
un-revoked table-wide default despite `task_routing_write_delegated` being a single `ALL` policy;
closed via `20260810230000_tier2_grant_lockdown.sql` (`select` + `insert`/`update` narrowed to
exactly `tenant_id, task_type, default_assignee_id, assignee_role`). Live-verified end-to-end
(`verify-buyer-leads-stage-tasks.ts`, `verify-tier2-grant-lockdown.ts`).

---

## Related Documents

- `cap-tasks-001` (Theos Registry) — full business-entity design rationale (generic polymorphic
  link, delegated-routing-settings pattern, default-routing-plus-manual-override assignment)
- DD-020 — Settings Delegations (`settings_edit_delegations`, the `has_settings_delegation()`
  gate this table's write policy uses)
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- `supabase/migrations/20260728200000_tasks_schema.sql` — original table shape
- `supabase/migrations/20260728220000_tasks_assignee_role.sql` — `assignee_role`
- `supabase/migrations/20260808130000_notifications_task_due_reminder.sql` — `reminder_sent_at`
- `supabase/migrations/20260808140000_search_core_entities.sql` — `search_vector`
- `supabase/migrations/20260808160000_tasks_updated_at_trigger.sql` — the missing trigger fix

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-08-09 | Initial version, written retroactively from a 2026-08-09 birds-eye audit — this domain had zero DD coverage across four migrations since 2026-07-28. |
| 1.1.0 | 2026-08-10 | **Correction.** Both tables' actual grants were table-wide (not column-scoped as described/implied), and `anon` held the identical default on both. Closed via `20260810240000_tier1_grant_lockdown.sql` / `20260810230000_tier2_grant_lockdown.sql` (`tb-platform-grant-lockdown-001`). Correction to previously-inaccurate documentation, hence a minor bump per STD-002. |
