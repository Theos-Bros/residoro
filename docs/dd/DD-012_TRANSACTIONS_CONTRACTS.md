# DD-012 — Transactions: Contract

**Status:** Draft
**Version:** 1.1.0
**Owner:** Residoro Engineering
**Created:** 2026-08-04
**Last Updated:** 2026-08-10

---

## Purpose

Exact table/column/constraint definitions for `public.contracts`, as implemented by
`tb-transactions-contract-001` (`supabase/migrations/20260804120000_transactions_contracts.sql`).
Written at implementation time, per RFC-004's documentation cadence requirement.

---

## Scope

Covers `public.contracts` only. Does not cover `offers` (DD-011) or `buyer_requirements` (DD not
yet written — see `cap-buyer-leads-001`'s own noted DS/DD coverage gap) or `listings` (DD-006).
Does not cover Closing (now built — see DD-013), a separate tracer bullet under the same parent
capability (`cap-transactions-001`).

---

## Table: `contracts`

The third real record behind an inert `buyer_requirements.stage` label — the first half of
`'contract_closing'` (the second half, Closing, is `tb-transactions-closing-001`). Seeded from an
accepted `offers` row.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `buyer_requirement_id` | `uuid` | not null, FK → `buyer_requirements(id)` | Derived server-side from `offer_id`, not client input |
| `listing_id` | `uuid` | not null, FK → `listings(id)` | Derived server-side from `offer_id`, not client input |
| `offer_id` | `uuid` | not null, FK → `offers(id)`, **unique** | The accepted offer this contract was seeded from; the unique constraint prevents double-creation, not a one-contract-per-lead rule (see Server-Side Behavior) |
| `agreed_price` | `numeric` | not null | Defaults to the offer's `amount` at creation, editable after |
| `currency` | `text` | not null, default `'PHP'` | Defaults to the offer's `currency` at creation |
| `terms` | `text` | nullable | Defaults to the offer's `terms` at creation, editable after |
| `signing_status` | `text` | not null, default `'drafted'`, `CHECK` in (`drafted`, `sent`, `signed`, `void`) | See Server-Side Behavior for the state machine |
| `signed_at` | `timestamptz` | nullable | Stamped when `signing_status` reaches `'signed'` |
| `created_by` | `uuid` | FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

Indexes: `idx_contracts_offer_id` (**unique**) on `(offer_id)`, `idx_contracts_tenant_id` on
`(tenant_id)`, `idx_contracts_buyer_requirement_id` on `(buyer_requirement_id)`,
`idx_contracts_listing_id` on `(listing_id)`.

---

## Row-Level Security

Tenant-scoped CRUD, same shape as `offers` (DD-011) and `viewings` (DD-010): no admin-only delete
gate. A contract record is treated as an operational record correctable by whoever's workspace it
belongs to, matching this domain's existing precedent rather than reopening the decision.

| Policy | Rule |
|---|---|
| `contracts_select_tenant` | `select` where `tenant_id = current_tenant_id()` |
| `contracts_insert_tenant` | `insert` with check `tenant_id = current_tenant_id()` |
| `contracts_update_tenant` | `update` where/with check `tenant_id = current_tenant_id()` |
| `contracts_delete_tenant` | `delete` where `tenant_id = current_tenant_id()` |

`authenticated` granted `select, insert, update, delete`. `service_role` has full access.
Written on the per-request scoped client throughout (`contracts.ts`), consistent with ADR-003's
scoped-client enforcement pattern.

**Correction (2026-08-10, `tb-platform-grant-lockdown-001`):** wrong on two counts — table-wide,
not column-scoped, and `delete` was never used (no `DELETE /contracts/:id` route exists — a
contract is voided via `signing_status`, never removed). `anon` held the identical default too.
Closed via `supabase/migrations/20260810240000_tier1_grant_lockdown.sql`: `select` + `insert` on
exactly `tenant_id, buyer_requirement_id, listing_id, offer_id, agreed_price, currency, terms,
created_by` + `update` on exactly `agreed_price, currency, terms, signing_status, signed_at` — no
`delete` grant. Live-verified end-to-end via the real full deal-flow
(`verify-tier1-transactions-grant-lockdown.ts`, 12/12 checks pass, including the drafted -> sent
-> signed transition).

---

## Server-Side Behavior Beyond the Schema

**Contract creation (`POST /contracts`)** takes only `offer_id` (plus optional `agreed_price`/
`currency`/`terms` overrides). The offer must belong to the caller's tenant and be `status =
'accepted'`; `buyer_requirement_id`/`listing_id` are read off the offer server-side rather than
trusted as client input, avoiding a redundant payload that could be made to disagree with it. A
pre-check rejects a second contract for the same `offer_id` with a 400 before the unique index
would otherwise reject it as a DB error.

**Signing state machine (`PATCH /contracts/:id`)**:

```
drafted -> sent -> signed
drafted -> void
sent    -> void
signed  -> (terminal)
void    -> (terminal)
```

Confirmed with the user at scoping time (the tracer bullet's own flagged open question): only
`'signed'` advances `buyer_requirements.stage` to `'contract_closing'` — not `'sent'`, since a
sent-but-unsigned contract is still reversible and the stage name implies real commitment. `'void'`
means the deal fell through before signing and never advances the stage.

Reaching `'signed'` stamps `signed_at = now()` and advances `buyer_requirements.stage` to
`'contract_closing'` — forward-only, same `STAGE_ORDER` index-comparison rule `tb-transactions-
offers-001` established for its own `'negotiating'` advance (local copy in `contracts.ts`, not
shared, for the same reason `offers.ts` gave). `createStageChangeTask` fires on advance, reusing
the `STAGE_TASK_TITLES.contract_closing` entry ("Prepare contract paperwork") that already existed
unused since `tb-buyer-leads-stage-tasks-001`.

Terms/price/currency edits are accepted in the same `PATCH` call regardless of `signing_status`
(e.g. correcting a typo after marking a contract `'sent'`) — no field-level lock tied to signing
progress.

**Read endpoints** (`GET /buyer-requirements/:id/contract`, `GET /listings/:id/contract`) return
the single most recent contract row (`order by created_at desc limit 1`) rather than a list — a
lead can accumulate more than one contract row over time (e.g. a `'void'`'d contract followed by a
fresh offer/contract cycle), but only the newest is ever the "current" one the UI shows.

---

## Related Documents

- `cap-transactions-001` (Theos Registry) — parent capability
- `tb-transactions-contract-001` (Theos Registry) — the tracer bullet this DD documents
- `tb-transactions-offers-001` / DD-011 — the accepted offer this tracer bullet seeds from
- `tb-transactions-closing-001` — the second half of the `contract_closing` stage label, not yet
  built
- DD-006 — Listings & Docket Sharing (the `listings` FK target)
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260804120000_transactions_contracts.sql`

---

## Revision History

| Version | Date | Description |
|---------|------|--------------|
| 1.0.0 | 2026-08-04 | Initial version, written alongside implementation per RFC-004. |
| 1.1.0 | 2026-08-10 | **Correction.** `authenticated`'s grant was table-wide (not column-scoped) and included an unused `delete`; `anon` held the identical default. Closed via `20260810240000_tier1_grant_lockdown.sql` (`tb-platform-grant-lockdown-001`). Correction to previously-inaccurate documentation, hence a minor bump per STD-002. |
