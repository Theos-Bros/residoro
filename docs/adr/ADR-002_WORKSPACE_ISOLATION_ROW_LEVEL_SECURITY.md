# ADR-002 — Workspace Isolation & Row-Level Security

**Status:** Approved
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-07-21

---

## Purpose

Record how tenant isolation established by ADR-001 is actually enforced: Postgres Row-Level
Security (RLS), keyed off the requesting user's `tenant_id`, looked up via Supabase Auth's
`auth.uid()`.

---

## Scope

Applies to every table carrying `tenant_id`. Does not cover fine-grained per-field or
per-action permissions beyond a basic `admin`/`member` role — that's the Permission Engine, a
separate future milestone (see `mil-platform-foundation-001`'s `semantic_scope`).

---

## Context

ADR-001 established a shared schema; this closes the "how do we actually stop Tenant A from
reading or writing Tenant B's rows" gap. Supabase Auth's `auth.uid()` (the authenticated
caller's user id) plus a `profiles` table mapping user → `tenant_id` is the standard pattern
for this on Supabase.

---

## Decision

1. Every tenant-scoped table has `alter table ... enable row level security` applied in the
   same migration that creates it — never as a follow-up.
2. Two helper functions, `current_tenant_id()` and `current_role()`, read the caller's
   `tenant_id`/`role` from `profiles` via `auth.uid()`. Both are `SECURITY DEFINER`, `STABLE`,
   and set `search_path = ''` with fully schema-qualified references inside.

   **Why `SECURITY DEFINER` is required, not optional:** `profiles` itself has an RLS policy
   (`profiles_select_same_tenant`) that calls `current_tenant_id()`. If that function ran with
   the caller's own privileges, its inner `select tenant_id from profiles where id = auth.uid()`
   would itself be subject to `profiles`' RLS policy — which calls `current_tenant_id()` again —
   infinite recursion. Defining the function as `SECURITY DEFINER`, owned by the same role that
   owns the tables, makes its inner `select` bypass RLS the same way a table owner's own direct
   queries do, breaking the cycle.

   **Why `search_path = ''`:** without pinning the search path, a function marked
   `SECURITY DEFINER` is exploitable — a malicious caller could create an object earlier in
   their own search path that shadows an unqualified reference inside the function body, and
   the function would silently use it while running with the definer's elevated privileges.
   Pinning `search_path = ''` and fully qualifying every reference (`public.profiles`,
   `auth.uid()`) closes that off.
3. Policies compare `tenant_id = current_tenant_id()` for `select`/`insert`/`update`;
   admin-gated actions additionally require `current_role() = 'admin'`.

---

## Consequences

- (+) Isolation holds even if application code forgets a `WHERE tenant_id = ...` clause — the
  database enforces it regardless of which code path issued the query.
- (+) Works uniformly for direct SQL, the Node.js backend, and the frontend's anon-key client —
  one enforcement point, not three.
- (–) Any query issued via Supabase's **service-role** key bypasses RLS entirely, by design.
  This is a deliberate, accepted escape hatch for trusted backend jobs (e.g. the future
  migration importer, which must write into an arbitrary tenant's `properties` table on the
  user's behalf) — not a gap to close, but worth naming so it isn't mistaken for one later.
- (–) Every RLS-checked query now does an extra lookup against `profiles` via the helper
  functions. Acceptable at this scale; if it becomes a measurable bottleneck, the standard next
  step is moving `tenant_id`/`role` into a custom JWT claim so the check is a JWT read instead
  of a table lookup — not needed yet.
- (–) A blanket `grant update on profiles to authenticated` would let a user escalate their own
  `role` or move themselves into another tenant by updating their own row — RLS's
  `using (id = auth.uid())` only restricts *which row*, not *which columns*. Closed via
  column-level grants: `authenticated` gets `update (full_name)` only on `profiles`; `role` and
  `tenant_id` are mutable only through the `SECURITY DEFINER` signup trigger or direct
  service-role access.

---

## Related Documents

- ADR-001 — Shared-Schema Multi-Tenant Architecture
- CTX-007 — Glossary ("Workspace", "Row Level Security (RLS)")
- DD-001 — Workspaces & Profiles
- DD-002 — Properties

---

## Note on ADR Numbering

`CTX-001` and `CTX-002` originally cited this decision as "ADR-006 — Workspace Isolation,"
while `CTX-003` lists a complete, internally-consistent ADR-001…ADR-006 sequence with this
decision as ADR-002 and "Workspace Naming Convention" reserved for ADR-006. Since no ADR files
existed before this one, CTX-003's numbering was adopted as authoritative and CTX-001/CTX-002
corrected to match — see their revision history.

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial decision record, written alongside the first migration that implements it. |
