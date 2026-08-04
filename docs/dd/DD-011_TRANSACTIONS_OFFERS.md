# DD-011 — Transactions: Offers

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-08-04
**Last Updated:** 2026-08-04

---

## Purpose

Exact table/column/constraint definitions for `public.offers`, as implemented by
`tb-transactions-offers-001` (`supabase/migrations/20260804110000_transactions_offers.sql`).
Written at implementation time, per RFC-004's documentation cadence requirement.

---

## Scope

Covers `public.offers` only. Does not cover `buyer_requirements` (DD not yet written — see
`cap-buyer-leads-001`'s own noted DS/DD coverage gap) or `listings` (DD-006). Does not cover
Contracts or Closing — separate, not-yet-built tracer bullets under the same parent capability
(`cap-transactions-001`), each expected to get its own DD entry when built.

---

## Table: `offers`

The second real record behind an inert `buyer_requirements.stage` label — this one for
`'negotiating'`. Also the first writer of `listings.status = 'under_offer'`, a legal transition
shipped by `tb-listings-status-ladder-001` that nothing set until now.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `buyer_requirement_id` | `uuid` | not null, FK → `buyer_requirements(id)` | |
| `listing_id` | `uuid` | not null, FK → `listings(id)` | |
| `offered_by` | `text` | not null, `CHECK` in (`buyer`, `seller`) | Which side made this specific offer/counter |
| `amount` | `numeric` | not null | |
| `currency` | `text` | not null, default `'PHP'` | Matches `listings.price_currency`'s own default |
| `terms` | `text` | nullable | Free-form |
| `status` | `text` | not null, default `'pending'`, `CHECK` in (`pending`, `countered`, `accepted`, `rejected`, `withdrawn`) | See Server-Side Behavior for the state machine |
| `supersedes_offer_id` | `uuid` | FK → `offers(id)` | Points at the offer this one counters; walking it backward is the negotiation history for one `buyer_requirement_id` + `listing_id` pair — no separate "negotiation" entity |
| `created_by` | `uuid` | FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

Indexes: `idx_offers_tenant_id` on `(tenant_id)`, `idx_offers_buyer_requirement_id` on
`(buyer_requirement_id)`, `idx_offers_listing_id` on `(listing_id)`, `idx_offers_supersedes_offer_id`
on `(supersedes_offer_id)`.

---

## Row-Level Security

Tenant-scoped CRUD, same shape as `viewings` (DD-010): **no admin-only delete gate**. An offer
record is treated as an operational log entry correctable by whoever's workspace it belongs to,
not a core record requiring admin-only delete (`buyer_requirements`/`contacts`'s pattern) — the
tracer bullet's doc didn't call this out as an open question, so it defaults to the precedent
`viewings` already set rather than reopening the decision.

| Policy | Rule |
|---|---|
| `offers_select_tenant` | `select` where `tenant_id = current_tenant_id()` |
| `offers_insert_tenant` | `insert` with check `tenant_id = current_tenant_id()` |
| `offers_update_tenant` | `update` where/with check `tenant_id = current_tenant_id()` |
| `offers_delete_tenant` | `delete` where `tenant_id = current_tenant_id()` |

`authenticated` granted `select, insert, update, delete`. `service_role` has full access.
Written on the per-request scoped client throughout (`offers.ts`), consistent with ADR-003's
scoped-client enforcement pattern.

---

## Server-Side Behavior Beyond the Schema

**Offer/counter state machine** — a refinement of the tracer bullet doc's own sketch, made at
implementation time (see the tracer bullet's Notes for the reasoning): `POST /offers` without
`supersedes_offer_id` records a fresh initial offer (`status = 'pending'`). With
`supersedes_offer_id`, it marks the prior offer `'countered'` (only legal if that prior offer is
currently `'pending'`) and inserts the new row as `'pending'` — so `'pending'` consistently means
"awaiting a response" for every row, original or counter.

`PATCH /offers/:id` accepts `status` ∈ (`accepted`, `rejected`, `withdrawn`), only from a
`'pending'` offer. On `'accepted'`:

1. All other `'pending'` offers in the same chain (same `buyer_requirement_id` + `listing_id`)
   are auto-closed to `'rejected'`.
2. `listings.status` is flipped to `'under_offer'` if legal per `listings.ts`'s own
   `STATUS_TRANSITIONS` table (exported for this purpose) — confirmed with the user this should
   be automatic, not manual, since the `under_offer` transition exists specifically for this. If
   the listing isn't in a state where `under_offer` is legal (e.g. already `sold`/`withdrawn`),
   the flip is silently skipped rather than blocking acceptance.
3. `buyer_requirements.stage` advances to `'negotiating'` — forward-only, same
   `STAGE_ORDER` index-comparison rule `tb-transactions-viewings-001` established for its own
   `'viewing'` advance (local copy in `offers.ts`, not shared, for the same reason `viewings.ts`
   gave). `createStageChangeTask` fires on advance, reusing the `STAGE_TASK_TITLES.negotiating`
   entry ("Follow up post-negotiation") that already existed unused since
   `tb-buyer-leads-stage-tasks-001`.

**Deliberately not automated:** a fallen-through deal (offer rejected/withdrawn with no
acceptance) does **not** auto-revert `listings.status` back to `'active'` — the tracer bullet's
own draft named this an open question and defaulted to manual, "to avoid surprising an agent
mid-relist." That default was kept as-is; not asked again since the live decision needed was only
the acceptance-side auto-flip.

---

## Related Documents

- `cap-transactions-001` (Theos Registry) — parent capability
- `tb-transactions-offers-001` (Theos Registry) — the tracer bullet this DD documents
- `tb-transactions-viewings-001` / DD-010 — precedes an offer in the pipeline, no hard dependency
- `tb-listings-status-ladder-001` — owns the `under_offer` transition this tracer bullet's
  acceptance path finally wires up
- DD-006 — Listings & Docket Sharing (the `listings` FK target)
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260804110000_transactions_offers.sql`

---

## Revision History

| Version | Date | Description |
|---------|------|--------------|
| 1.0.0 | 2026-08-04 | Initial version, written alongside implementation per RFC-004. |
