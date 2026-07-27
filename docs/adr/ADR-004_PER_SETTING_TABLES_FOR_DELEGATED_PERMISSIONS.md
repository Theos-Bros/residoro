# ADR-004 — Per-Setting Tables for Delegated (Toggle-able) Permissions

**Status:** Approved — Implemented
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-28
**Last Updated:** 2026-07-28

---

## Purpose

Record how Residoro enforces a *dynamic, per-user, per-setting* permission (a non-admin member
granted edit rights on one specific Settings sub-section) at the database layer, without a
service-role bypass — extending ADR-003's "RLS is the real enforcement boundary" decision to a
class of problem ADR-003 didn't cover: permissions that vary per individual user within a
tenant, not just per tenant.

---

## Scope

Applies to `tb-brokerage-permissions-delegation-001`'s two delegatable settings
(`sharing_templates`, `performance`) and any future toggle-able Settings sub-section built the
same way. Does not change tenant isolation itself (ADR-001/002/003, unchanged) — this is about
enforcing permission differences *between members of the same tenant*.

---

## Context

`tb-brokerage-permissions-delegation-001` needed: an admin can grant a specific non-admin member
edit rights on one Settings sub-section (e.g. Sharing Templates) without making them a full
admin. The first implementation (`20260728110000_settings_edit_delegations.sql`) added a
`settings_edit_delegations` grants table, an app-level `canEditSetting()` check, and — because
`sharing_templates`/`performance` lived as plain columns on the shared `workspaces` row, next to
unrelated admin-only settings (`contract_end_date`, `exclusivity_hard_block`, ...) — routed the
actual write through the service-role client (`supabaseAdmin`) once the app-level check passed.

That worked, but it reintroduced exactly the pattern ADR-003 spent a whole tracer bullet
(`tb-platform-rls-scoped-client-001`) removing: an app-level check followed by a privileged write
the database itself has no way to independently verify. Raised directly by the user during review
(2026-07-28): if a future route or refactor ever skipped `canEditSetting()`, there would be no
database-level backstop, since RLS's existing `workspaces_update_admin` policy only recognizes
`current_role() = 'admin'`, never a per-user delegation grant.

**Why a straightforward RLS policy addition on `workspaces` wasn't sufficient:** RLS enforces at
row granularity, not column granularity. `sharing_templates` and `performance` are two columns on
the *same* `workspaces` row as several admin-only settings unrelated to delegation. A policy like
"allow the update if a delegation exists for this user" would have let a member granted
*only* `sharing_templates` write to `hot_share_threshold`, `contract_end_date`, or any other
column on that row too — RLS has no way to say "...but only these two columns." A trigger-based
per-column diff (comparing `OLD`/`NEW`) was considered and rejected in favor of the option below:
smaller footprint, same guarantee, no imperative code path to keep in sync with future schema
changes to `workspaces`.

---

## Decision

1. **Each delegatable setting gets its own table, one row per tenant**, rather than living as
   columns on the shared `workspaces` row. `workspace_sharing_settings`
   (`public_share_template`, `co_broker_share_template`) and `workspace_performance_settings`
   (`hot_share_threshold`) replace the equivalent `workspaces` columns, which are dropped.
   Because RLS operates per row, and each setting now owns its own row, ordinary row-level RLS
   *is* setting-level enforcement — no trigger, no column-diffing code required.
2. **A reusable helper function**, `public.has_settings_delegation(setting_key text)`, encodes
   "caller is admin OR holds a matching `settings_edit_delegations` grant for this setting_key."
   Every per-setting table's own `UPDATE` policy calls this directly
   (`using (tenant_id = current_tenant_id() and has_settings_delegation('sharing_templates'))`)
   instead of re-deriving the check. A future toggle-able setting adds: one new table, one
   `setting_key` value in `settings_edit_delegations`' check constraint, and a ~4-line policy
   calling this same helper — not new procedural code. See
   `learn-delegated-permissions-rls-001` (theos-playbook) for the cross-project version of this
   guidance.
3. **The caller's own scoped client performs every write directly** — `shareText.ts`,
   `analytics.ts`, and `settingsPermissions.ts` all dropped their `supabaseAdmin` usage for these
   paths. `settings_edit_delegations` itself also gained admin-only insert/update/delete RLS
   policies (mirroring `workspaces_update_admin`'s shape), so granting/revoking a delegation is
   no longer a service-role write either.
4. **App-level checks (`canEditSetting()`, the route's own `role === 'admin'` checks) are kept**,
   not removed — they return a clean 403 instead of a generic Postgres/RLS failure, the same
   "hand-written filter as first layer, RLS as the real guarantee underneath" shape ADR-003
   established for tenant isolation. They are defense-in-depth now, not the only defense.

---

## Consequences

- (+) No service-role bypass anywhere in the delegated-settings feature. A future bug that skips
  the app-level check can no longer grant an unauthorized write — the database blocks it
  regardless of application code. Verified live 2026-07-28
  (`verify-brokerage-permissions-delegation.ts`): a direct PostgREST write through the delegated
  member's own scoped client — with the backend API skipped entirely — is blocked before any
  grant exists, succeeds once granted, and stays blocked on the *other* setting's table even
  with an active grant (proving per-setting, not per-row, enforcement).
- (+) The reusable-pattern shape (`has_settings_delegation()` + one table per setting) makes
  adding a third delegatable setting later a small, mechanical addition rather than a new design
  decision.
- (–) Two extra tables and a data migration versus keeping columns on `workspaces` — a larger
  footprint than the original single-migration approach, accepted for the enforcement guarantee.
- (–) Reading a delegated setting now costs one extra table (a dedicated table instead of a
  column on an already-fetched `workspaces` row) — negligible at current scale, same tradeoff
  ADR-003 already accepted for `current_tenant_id()`/`current_role()`'s per-query lookups.
- (–) `workspaces.public_share_template`, `co_broker_share_template`, and `hot_share_threshold`
  are gone — any historical script or query referencing them directly (rather than through the
  API) will fail. No real client data existed yet, so this was a clean cutover, not a breaking
  migration for production data.

---

## Related Documents

- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes (the precedent this ADR
  extends from "per-tenant" to "per-user-within-a-tenant" enforcement)
- ADR-002 — Workspace Isolation & Row-Level Security (`current_tenant_id()`/`current_role()`,
  reused directly by `has_settings_delegation()`)
- `tb-brokerage-permissions-delegation-001` (theos-registry) — the tracer bullet this ADR was
  written during
- `learn-delegated-permissions-rls-001` (theos-playbook) — the generalized, cross-project version
  of this pattern

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-28 | Initial decision record. Written after the user identified that the tracer bullet's first implementation (service-role bypass after an app-level check) reintroduced the exact anti-pattern ADR-003 had removed elsewhere in the codebase. |
