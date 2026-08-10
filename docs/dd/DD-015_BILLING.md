# DD-015 — Billing: Contract Value & Installment Tracking

**Status:** Draft
**Version:** 1.1.0
**Owner:** Residoro Engineering
**Created:** 2026-08-06
**Last Updated:** 2026-08-10

---

## Purpose

Exact table/column/constraint definitions for `public.contract_billing` and
`public.billing_installments`, as implemented by `tb-billing-installments-001`
(`supabase/migrations/20260806100000_billing_installments.sql`). Written at implementation time,
per RFC-004's documentation cadence requirement.

---

## Scope

Covers `contract_billing` and `billing_installments` only — `cap-billing-001`'s first tracer
bullet. Does not cover invoice document generation or the brokerage-side read-only view, both
unscoped future tracer bullets under the same capability. Does not cover any payment
processor integration — explicitly rejected per `cap-client-lifecycle-001` Decision #1; these
tables are a system of record for payment that happens outside Residoro, not a payments
capability.

---

## Table: `contract_billing`

Singleton per-tenant row — a client's total contract value. Set/updated only via
`PUT /admin/clients/:id/billing`, an operator-authenticated route.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `tenant_id` | `uuid` | PK, FK → `workspaces(id)` on delete cascade | |
| `contract_value` | `numeric` | not null | No relationship enforced against the sum of `billing_installments.amount` — see Server-Side Behavior |
| `currency` | `text` | not null, default `'PHP'` | Matches every other money field in residoro (offers, contracts, closings, commission) |
| `created_by` | `uuid` | FK → `auth.users(id)` | The operator who set it |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

---

## Table: `billing_installments`

One or more manually-defined installments against a tenant's `contract_billing` record. Written
via `POST`/`PATCH`/`DELETE /admin/clients/:id/billing/installments[/:id]`, operator-authenticated
routes only.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` on delete cascade | |
| `amount` | `numeric` | not null | |
| `currency` | `text` | not null, default `'PHP'` | |
| `due_date` | `date` | not null | |
| `status` | `text` | not null, default `'unpaid'`, `CHECK` in (`unpaid`, `paid`) | Text enum, matching this codebase's dominant status-field convention (`contacts.status`, `listing_dockets.status`, `offers.status`, `import_batches.status`, `training_sessions.status`) over a boolean — considered and confirmed with the user 2026-08-06 |
| `paid_date` | `date` | nullable | Set when marked paid (defaults to today if the operator doesn't supply one); cleared to null when marked unpaid |
| `created_by` | `uuid` | FK → `auth.users(id)` | The operator who created it |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

**Constraint:** `billing_installments_paid_date_matches_status` — `check ((status = 'paid') =
(paid_date is not null))`. Direct DB-level enforcement of the "a paid date is recorded when
marked paid" invariant — distinct from the sum-vs-`contract_value` question below, which stays
app-level-warning-only.

Index: `idx_billing_installments_tenant_id` on `(tenant_id)`.

---

## Row-Level Security

Read-only for the tenant's own admin; **no INSERT/UPDATE/DELETE policy exists for
`authenticated` on either table at all** — every write goes through an operator-authenticated
backend route using the service-role client (`tb-client-lifecycle-operator-access-001`'s
established pattern), never a direct RLS-scoped write.

This is the first tenant-owned *financial* table in residoro that grants the tenant's own admin
real RLS-level read access (not just service-role-only, like `training_sessions` / DD-009) —
confirmed with the user 2026-08-06 as a deliberate choice: the SELECT policy ships now as
baseline tenant-scoping hygiene even though no brokerage-facing UI reads it yet (a later tracer
bullet). The doc originally sketched deferring the admin-role check to an application layer that
doesn't exist yet in this slice; that was corrected before shipping to use the same RLS-level
`current_role()` check `workspaces_update_admin`/`properties_delete_admin` (DD-001/DD-002)
already use, rather than inventing a new enforcement point.

| Policy | Rule |
|---|---|
| `contract_billing_select_admin` | `select` where `tenant_id = current_tenant_id() and current_role() = 'admin'` |
| `billing_installments_select_admin` | `select` where `tenant_id = current_tenant_id() and current_role() = 'admin'` |

`authenticated` granted `select` only on both tables (no insert/update/delete grant at all).
`service_role` has full access.

Live-verified 2026-08-06, not just assumed from the schema (`scripts/
verify-billing-rls-and-flow.ts`): the target tenant's own admin can SELECT both tables for their
own tenant; the same admin CANNOT SELECT another tenant's rows (empty result, no app-level
filter applied); a non-admin member of the *same* tenant CANNOT SELECT either table; an
RLS-scoped INSERT attempt as the tenant admin is rejected.

**Correction (2026-08-10):** "`authenticated` granted `select` only... no insert/update/delete
grant at all" was wrong — `authenticated` actually held Supabase's un-revoked default table-wide
INSERT/UPDATE/DELETE/TRUNCATE on both tables the entire time. The 2026-08-06 live-verification's
"INSERT attempt... is rejected" finding was still correct, but for the wrong reason stated here:
it was RLS's total absence of an INSERT policy blocking it (default-deny), not an absent grant —
the grant was present and armed the whole time. Found in the 2026-08-10 follow-up security pass
that generalized DD-001 Finding 7's fix beyond the two tables it originally covered; not
currently exploitable given the missing write policies, but the same "grant assumed narrow,
never actually was" trap DD-001/DD-014 also fell into, one future write-policy addition away from
becoming live. Fixed via `supabase/migrations/20260810200000_financial_audit_grant_lockdown.sql`
(`revoke all` then `grant select` only, matching what this section always claimed was already
true). Re-verified live via `scripts/verify-financial-audit-grant-lockdown.ts`.

---

## Server-Side Behavior Beyond the Schema

**No DB-level validation that installments sum to `contract_value`.** Considered and confirmed
with the user 2026-08-06: contracts can legitimately change mid-term (renegotiation, discounts,
added scope), so a hard sum constraint would fight real operator workflows. The admin dashboard
(`ClientBilling.tsx`) shows a non-blocking warning when the sums don't match, skipped entirely
when installments span more than one currency.

**`PATCH .../installments/:id` rejects `paid_date` unless paired with `status: 'paid'`** in the
same request — a 400 with a clear message, rather than letting the request reach the DB and fail
against `billing_installments_paid_date_matches_status` as a raw constraint violation.

---

## Related Documents

- `cap-billing-001` (Theos Registry) — parent capability
- `tb-billing-installments-001` (Theos Registry) — the tracer bullet this DD documents
- DD-001 (Workspaces & Profiles) — `current_tenant_id()`/`current_role()` RLS helper functions,
  and the `workspaces_update_admin`/`properties_delete_admin` precedent for an RLS-level admin
  check
- DD-009 (Training Sessions) — the service-role-only RLS posture this table's *write* side
  follows, though this table's *read* side (tenant-admin SELECT) is new ground
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260806100000_billing_installments.sql`

---

## Revision History

| Version | Date | Description |
|---------|------|--------------|
| 1.0.0 | 2026-08-06 | Initial version, written alongside implementation per RFC-004. |
| 1.1.0 | 2026-08-10 | **Correction.** Row-Level Security's "no insert/update/delete grant at all" claim was inaccurate — the un-revoked Supabase default table-wide grant was present the whole time, latent behind the absence of a write policy. Fixed via `20260810200000_financial_audit_grant_lockdown.sql`. Correction to previously-inaccurate documentation, not a new schema change, hence a minor bump per STD-002. |
