# DD-006 — Listings & Docket Sharing

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Exact table/column/constraint definitions for `listings` and `listing_dockets`, as implemented
across five migrations from `tb-listings-create-001` through
`tb-listings-authority-expiry-notification-001`. Written retroactively as part of a 2026-07-27
birds-eye review.

---

## Scope

Covers `public.listings` and `public.listing_dockets`. Does not cover `properties` (DD-002,
the entity a listing markets) or CRM/commission/transaction data (future capabilities).

---

## Table: `listings`

Marketing authority over a property — a property can carry zero, one, or many listings over
time. Mirrors `properties`'s table shape and RLS pattern.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `property_id` | `uuid` | not null, FK → `properties(id)` | |
| `agent_id` | `uuid` | not null, FK → `profiles(id)` | Always the creating profile — no distinct Agent/Team-Lead role exists in `profiles.role` (`admin`\|`member`\|`operator`) yet, so cross-agent assignment is deferred |
| `listing_type` | `text` | not null, `CHECK` in (`sale`, `rent`) | |
| `price` | `numeric(14,2)` | not null | |
| `price_currency` | `text` | not null, default `'PHP'` | |
| `status` | `text` | not null, default `'draft'`, `CHECK` in (`draft`, `active`, `under_offer`, `sold`, `expired`, `withdrawn`) | Widened from an original `draft`/`active`/`withdrawn`-only set by `tb-listings-lifecycle-001`. Legal transitions enforced in application code (`listings.ts`), not a DB trigger. Listings are never deleted — reassigning to a new agent means withdrawing this row and creating a new one |
| `exclusivity` | `text` | not null, default `'open'`, `CHECK` in (`exclusive`, `open`) | Added by `tb-listings-authority-001`. Mirrors the real Authority to Sell/Lease agreement type. Enforcement is a soft warning by default (see `workspaces.exclusivity_hard_block`, DD-001) |
| `authority_starts_at` | `timestamptz` | not null, default `now()` | Same migration |
| `authority_expires_at` | `timestamptz` | nullable | Same migration. Nullable — open-ended authority is allowed |
| `authority_warning_7d_sent_at` | `timestamptz` | nullable | Added by `tb-listings-authority-expiry-notification-001`. Idempotency flag, same pattern as `workspaces.warning_*_sent_at` (DD-001) — reset to null by the Edge Function if `authority_expires_at` is pushed back out past 7 days (renewal case), so a future approach re-warns |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

Indexes: `idx_listings_tenant_id` on `(tenant_id)`, `idx_listings_property_id` on `(property_id)`.

## Table: `listing_dockets`

A curated, field-selectable share of one Listing to one specific recipient account, by
`profiles.handle` (DD-001) — no organizational affiliation required. The one genuinely
cross-tenant table in this schema: the recipient's own tenant is never the source listing's
tenant.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `source_listing_id` | `uuid` | not null, FK → `listings(id)` | |
| `source_tenant_id` | `uuid` | not null, FK → `workspaces(id)` | The sharer's tenant, recorded explicitly (not derivable from `shared_by` alone without a join) |
| `shared_by` | `uuid` | not null, FK → `profiles(id)` | |
| `shared_with` | `uuid` | not null, FK → `profiles(id)` | Resolved from a `@handle` lookup at share-creation time in application code, then stored as a stable id |
| `included_fields` | `jsonb` | not null | Array of field names the sharer chose to include (e.g. `["price", "city"]`). **Live projection, not a snapshot**: controls visibility only — every read joins straight through to the current `listings`/`properties` rows, so a docket always reflects the source listing's live state. Validated against a fixed allow-list in application code (`application/backend/src/routes/dockets.ts`), not enforced at the DB layer |
| `status` | `text` | not null, default `'active'`, `CHECK` in (`active`, `revoked`) | Revocation is immediate — `GET /listing-dockets/received` filters `status = 'active'`, so a revoked docket disappears from the recipient's next read with no extra mechanism needed |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

Indexes: `idx_listing_dockets_shared_with` on `(shared_with)`, `idx_listing_dockets_shared_by`
on `(shared_by)`, `idx_listing_dockets_source_listing_id` on `(source_listing_id)`.

---

## Row-Level Security

**`listings`**: standard tenant-scoped CRUD (no delete policy defined — listings are never
deleted, per the `status` column note above), matching `properties`'s pattern.

| Policy | Rule |
|---|---|
| `listings_select_tenant` | `select` where `tenant_id = current_tenant_id()` |
| `listings_insert_tenant` | `insert` with check `tenant_id = current_tenant_id()` |
| `listings_update_tenant` | `update` where/with check `tenant_id = current_tenant_id()` |

**`listing_dockets`**: identity-scoped (`auth.uid()`), **not** tenant-scoped — the whole purpose
of this table is cross-tenant visibility, so `current_tenant_id()` isn't the relevant boundary.
Mirrors `profiles_update_own`'s existing `auth.uid()` pattern (DD-001) instead.

| Policy | Rule |
|---|---|
| `listing_dockets_select_participant` | `select` where `shared_by = auth.uid()` or `shared_with = auth.uid()` |
| `listing_dockets_insert_sharer` | `insert` with check `shared_by = auth.uid()` and `source_tenant_id = current_tenant_id()` |
| `listing_dockets_update_sharer` | `update` where/with check `shared_by = auth.uid()` |

Both tables: `authenticated` granted `select, insert, update` (no `delete` on either — listings
are withdrawn not deleted; dockets are revoked not deleted). `service_role` has full access —
as with every other table, the backend currently uses `service_role` for all routes on both
tables (see ADR-002's "Superseded By (partial)" note and ADR-003).

---

## Related Documents

- DD-002 — Properties (the entity a listing markets)
- DD-001 — Workspaces & Profiles (`handle`, `exclusivity_hard_block`, `warning_*_sent_at` pattern)
- `cap-listings-001` (Theos Registry) — marketing-authority model and design rationale
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260722160000_listings.sql` — original `listings` table
- `supabase/migrations/20260722170000_listings_authority.sql` — exclusivity, authority dates
- `supabase/migrations/20260723110000_listing_dockets.sql` — `listing_dockets`
- `supabase/migrations/20260724100000_listings_lifecycle.sql` — widened `status`
- `supabase/migrations/20260725100000_listings_exclusivity_hardblock.sql` — `workspaces.exclusivity_hard_block` (DD-001)
- `supabase/migrations/20260727110000_listing_authority_expiry_notification.sql` — `authority_warning_7d_sent_at`

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review covering five already-shipped tracer bullets. |
