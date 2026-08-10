# DD-013 — Transactions: Closing

**Status:** Draft
**Version:** 1.1.0
**Owner:** Residoro Engineering
**Created:** 2026-08-04
**Last Updated:** 2026-08-10

---

## Purpose

Exact table/column/constraint definitions for `public.closings`, as implemented by
`tb-transactions-closing-001` (`supabase/migrations/20260804130000_transactions_closings.sql`).
Written at implementation time, per RFC-004's documentation cadence requirement.

---

## Scope

Covers `public.closings` only. Does not cover `contracts` (DD-012), `offers` (DD-011),
`buyer_requirements` (DD not yet written — see `cap-buyer-leads-001`'s own noted DS/DD coverage
gap), or `listings` (DD-006). Does not cover Commission — `cap-commission-001` is a separate,
sibling capability that consumes this tracer bullet's completion event but is not documented here.

---

## Table: `closings`

The fourth and final real record behind an inert `buyer_requirements.stage` label chain — the
second half of `'contract_closing'` (the first half is `contracts`, DD-012) and the producer of
the `'won'` transition. Also, as of this tracer bullet, the sole remaining writer of
`listings.status = 'sold'` and `listings.buyer_contact_id` — see Server-Side Behavior for why that
changed.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `contract_id` | `uuid` | not null, FK → `contracts(id)`, **unique** | The signed contract this closing was opened against; the unique constraint prevents double-opening, same reasoning as `contracts.offer_id` |
| `buyer_requirement_id` | `uuid` | not null, FK → `buyer_requirements(id)` | Derived server-side from `contract_id`, not client input |
| `listing_id` | `uuid` | not null, FK → `listings(id)` | Derived server-side from `contract_id`, not client input |
| `final_price` | `numeric` | not null | Defaults to the contract's `agreed_price` at creation, editable pre-completion |
| `currency` | `text` | not null, default `'PHP'` | Defaults to the contract's `currency` at creation |
| `checklist_state` | `jsonb` | not null, default `'{}'` | Reserved, extensible bag — unused by any code path today; TB1's actual checklist is `final_price` + `completed_at`, both real columns, per the tracer bullet's own "likely minimal for TB1" framing |
| `completed_at` | `timestamptz` | nullable | Set once, on completion; a completed closing's `final_price`/`currency`/`checklist_state` become immutable (see Server-Side Behavior) |
| `created_by` | `uuid` | FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

Indexes: `idx_closings_contract_id` (**unique**) on `(contract_id)`, `idx_closings_tenant_id` on
`(tenant_id)`, `idx_closings_buyer_requirement_id` on `(buyer_requirement_id)`,
`idx_closings_listing_id` on `(listing_id)`.

---

## Row-Level Security

Tenant-scoped CRUD, same shape as `contracts` (DD-012), `offers` (DD-011), and `viewings`
(DD-010): no admin-only delete gate.

| Policy | Rule |
|---|---|
| `closings_select_tenant` | `select` where `tenant_id = current_tenant_id()` |
| `closings_insert_tenant` | `insert` with check `tenant_id = current_tenant_id()` |
| `closings_update_tenant` | `update` where/with check `tenant_id = current_tenant_id()` |
| `closings_delete_tenant` | `delete` where `tenant_id = current_tenant_id()` |

`authenticated` granted `select, insert, update, delete`. `service_role` has full access.
Written on the per-request scoped client throughout (`closings.ts`), consistent with ADR-003's
scoped-client enforcement pattern.

**Correction (2026-08-10, `tb-platform-grant-lockdown-001`):** wrong on two counts — table-wide,
not column-scoped, and `delete` was never used (no `DELETE /closings/:id` route exists). `anon`
held the identical default too. Closed via `supabase/migrations/
20260810240000_tier1_grant_lockdown.sql`: `select` + `insert` on exactly `tenant_id, contract_id,
buyer_requirement_id, listing_id, final_price, currency, created_by` + `update` on exactly
`final_price, currency, checklist_state, completed_at` — no `delete` grant. Live-verified
end-to-end via the real full deal-flow (`verify-tier1-transactions-grant-lockdown.ts`, 12/12
checks pass, including the completion side effects that flip `listings.status` and advance
`buyer_requirements.stage`).

---

## Server-Side Behavior Beyond the Schema

**Closing creation (`POST /closings`)** takes only `contract_id`. The contract must belong to the
caller's tenant and have `signing_status = 'signed'`; `buyer_requirement_id`/`listing_id` are read
off the contract server-side. `final_price`/`currency` default from the contract's own
`agreed_price`/`currency`. A pre-check rejects a second closing for the same `contract_id` with a
400 before the unique index would otherwise reject it as a DB error.

**Editing (`PATCH /closings/:id`)** accepts `final_price`/`currency`/`checklist_state` field edits
at any point *before* `completed_at` is set — once a closing is completed, the row is locked (a
400 rejects any further field edit), since `cap-commission-001` may already have computed earnings
from it.

**Completion (`PATCH /closings/:id` with `completed: true`)** is a one-way action:

1. If the listing is a rental (`listing_type = 'lease'`, renamed from `'rent'` 2026-08-08 by
   `tb-listings-rent-to-lease-001`), `lease_end_date` is required in the same
   request — a 400 otherwise. This mirrors the pre-existing, options-sent-based `mark-won` route's
   own rule (`buyerRequirements.ts`), confirmed with the user as a deliberate parity requirement:
   both paths to `'won'` set the same downstream fields, so neither the Won banner nor the Revisit
   page's rental-tracking silently breaks depending on which pipeline closed the deal.
2. `listings.status` is flipped to `'sold'` and `listings.buyer_contact_id` is set to the lead's
   `contact_id`, if `'sold'` is a legal transition per `listings.ts`'s own `STATUS_TRANSITIONS`
   table (silently skipped otherwise, same "flip if legal" precedent `tb-transactions-offers-001`
   established for its own `under_offer` flip). **This is new automation, confirmed explicitly
   with the user** — it reverses a decision `tb-buyer-leads-schema-001` made and
   `tb-listings-status-ladder-001` re-confirmed (not reversed) on 2026-07-29: that marking a
   listing sold and marking a lead won are deliberately decoupled, manual, separate actions. Now
   that a real Closing feature exists, the user chose to finally couple them — see the tracer
   bullet's own Notes for the full framing of that decision.
3. `buyer_requirements.stage` advances to `'won'` — forward-only, same `STAGE_ORDER`
   index-comparison rule `tb-transactions-offers-001`/`tb-transactions-contract-001` established
   (local copy in `closings.ts`). Bundled into the same update: `won_listing_id` is set to the
   closing's `listing_id`, and `lease_end_date` is set (rentals only, else `null`) — full parity
   with what `mark-won` writes, per point 1 above. `createStageChangeTask` fires on advance,
   reusing the `STAGE_TASK_TITLES.won` entry ("Confirm sale closed") that already existed unused
   since `tb-buyer-leads-stage-tasks-001`.

The listing sold-flip (step 2) is unconditional on completion, independent of whether the
stage-advance in step 3 actually fires (e.g. a lead already in `'lost'` still gets its listing
flipped to `sold` if legal, but its stage is not force-reopened) — same independence
`tb-transactions-offers-001` established between its own listing-flip and stage-advance.

**Read endpoints** (`GET /buyer-requirements/:id/closing`, `GET /listings/:id/closing`) return the
single most recent closing row, same convention `tb-transactions-contract-001` established for its
own read endpoints.

---

## Related Documents

- `cap-transactions-001` (Theos Registry) — parent capability
- `tb-transactions-closing-001` (Theos Registry) — the tracer bullet this DD documents
- `tb-transactions-contract-001` / DD-012 — owns the signed contract this tracer bullet closes
  against
- `tb-crm-buyer-001` — original owner of the `sold`/`buyer_contact_id` write path, now also
  reachable automatically from Closing completion
- `tb-listings-status-ladder-001` — owns the prior "deliberately decoupled" decision this tracer
  bullet reverses, with explicit user confirmation
- `cap-commission-001` — downstream consumer of `contract_id`/`final_price`/`completed_at`
- DD-006 — Listings & Docket Sharing (the `listings` FK target)
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260804130000_transactions_closings.sql`

---

## Revision History

| Version | Date | Description |
|---------|------|--------------|
| 1.0.0 | 2026-08-04 | Initial version, written alongside implementation per RFC-004. |
| 1.0.1 | 2026-08-08 | `tb-listings-rent-to-lease-001`: the completion rule's `listing_type = 'rent'` check corrected to `'lease'` (that enum value was renamed app-wide). |
| 1.1.0 | 2026-08-10 | **Correction.** `authenticated`'s grant was table-wide (not column-scoped) and included an unused `delete`; `anon` held the identical default. Closed via `20260810240000_tier1_grant_lockdown.sql` (`tb-platform-grant-lockdown-001`). Correction to previously-inaccurate documentation, hence a minor bump per STD-002. |
