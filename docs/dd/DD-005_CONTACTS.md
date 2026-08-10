# DD-005 — Contacts

**Status:** Draft
**Version:** 1.4.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-08-10

---

## Purpose

Exact table/column/constraint definitions for `contacts`, as implemented by
`supabase/migrations/20260722140000_contacts.sql` (`tb-migration-contacts-001`). Written
retroactively as part of a 2026-07-27 birds-eye review.

---

## Scope

Covers only the `public.contacts` table. Does not cover `imported_contacts` (see DD-004) or the
CRM relationship data (lead status, assignment, activity history) a future CRM domain would add
— this is the bare Contact entity only.

---

## Table: `contacts`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `name` | `text` | not null | |
| `type` | `text` | not null, **no `CHECK` constraint** | Deliberately an open value set (`buyer_lead`, `co_broker`, `developer`, `owner`, ...), not an enum — a considered decision (`tb-migration-contacts-001` Context), revisit once real client data shows what values actually show up |
| `email` | `text` | nullable | |
| `phone` | `text` | nullable | |
| `company` | `text` | nullable | |
| `address` | `text` | nullable | Added by `tb-buyer-leads-inquiry-contact-carryover-001` (2026-08-09) so a qualified inquiry's captured address has somewhere to land — free text like `notes`, no structured components |
| `notes` | `text` | nullable | |
| `is_company` | `boolean` | not null, default `false` | Added by `tb-crm-developer-consolidation-001` (2026-07-28, `cap-crm-001` Milestone 1) when the standalone `developers` table was dropped and folded in here (`type = 'developer'`, `is_company = true` for former `developers` rows) — see DD-007 for that table's history |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | Nullable, same rationale as `properties.created_by` — bulk/service-role writes may not have a single acting user |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |
| `search_vector` | `tsvector` | generated always as, stored | Added by `tb-search-core-entities-001` (2026-08-08). `setweight(name, 'A') \|\| setweight(company, 'B')`. Feeds `search_global()`'s `contact` result type; `lead` results (`buyer_requirements`) are searched via the joined `contacts.search_vector`, since a Lead has no name field of its own (DD note above) |

Index: `idx_contacts_tenant_id` on `(tenant_id)`. `idx_contacts_search_vector` — GIN index on
`search_vector`, added by the same migration as the column.

This is the one deliberate schema deviation from `properties`'s pattern in this table: `type` is
plain unconstrained `text`, not a `CHECK (type in (...))` list like `properties.type`/`status`
(see DD-002's "Type Choices" for why those got a `CHECK`). Contacts' real-world type vocabulary
wasn't known well enough at write time to fix a list.

---

## Row-Level Security

Standard tenant-scoped CRUD, matching `properties`'s pattern exactly (DD-002).

| Policy | Rule |
|---|---|
| `contacts_select_tenant` | `select` where `tenant_id = current_tenant_id()` |
| `contacts_insert_tenant` | `insert` with check `tenant_id = current_tenant_id()` |
| `contacts_update_tenant` | `update` where/with check `tenant_id = current_tenant_id()` |
| `contacts_delete_admin` | `delete` where `tenant_id = current_tenant_id()` and `current_role() = 'admin'` |

`authenticated` is granted `select, insert, update, delete`. `service_role` has full access.
**Update, 2026-07-28 (`tb-platform-rls-scoped-client-001`, per ADR-003):** `contacts.ts` is now
fully on the per-request scoped client — RLS is the real enforcement boundary for `contacts`
routes now, not `service_role`.

**Correction (2026-08-10, `tb-platform-grant-lockdown-001`):** the verb set above (`select,
insert, update, delete`) was correct, but it was table-wide (every column), not scoped to what
`contacts.ts` actually writes — `contacts_update_tenant`'s RLS check is row-only (tenant), so any
tenant member could write any column via direct PostgREST. `anon` held the identical default too.
Both closed via `supabase/migrations/20260810240000_tier1_grant_lockdown.sql`: `revoke all` then
re-grant `select` + `insert`/`update` on exactly `name, type, is_company, email, phone, company,
notes` (+ `address` on insert only, matching the one route that sets it) + full `delete`. Live-
verified end-to-end via the real `/contacts` routes (`verify-buyer-leads-schema.ts`).

**Also unrepresented in this DD:** `tb-crm-contacts-page-001` (2026-07-28) shipped a unified
Contacts page (list + full CRUD via `contacts.ts`/`contactsApi.ts`) on top of this table without
changing its shape — a frontend/API-surface addition, not a schema change, so it doesn't add a
row here, but a reader relying on this doc alone wouldn't know a first-class Contacts UI exists.
See `cap-crm-001` in the Theos Registry for that capability's full scope.

---

## Related Documents

- DD-002 — Properties (parallel table shape and RLS pattern)
- DD-004 — Import Batches & Row Tracking (`imported_contacts`, the migration write-tracking sibling)
- `cap-migration-001` (Theos Registry) — generic Contact entity decision, scoped for migration purposes
- `cap-crm-001` (Theos Registry) — `is_company`, the Contacts page, Buyer/Seller relationships
- DD-007 — Developers & Projects (the dropped `developers` table `is_company` absorbed)
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260722140000_contacts.sql` — implements this doc
- `supabase/migrations/20260728140000_crm_developer_consolidation.sql` — `is_company` added
- `supabase/migrations/20260809100000_contacts_address.sql` — `address` added
- `supabase/migrations/20260808140000_search_core_entities.sql` — `search_vector` added

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review. |
| 1.1.0 | 2026-08-03 | Refreshed from a 2026-08-03 birds-eye review: added `is_company` (from the `developers` consolidation), corrected the stale `service_role`-for-all-routes RLS claim, noted the unified Contacts page shipped on top of this table. |
| 1.2.0 | 2026-08-09 | Added `address` (`tb-buyer-leads-inquiry-contact-carryover-001`) — closes the gap where a qualified inquiry's captured address had no destination. |
| 1.3.0 | 2026-08-09 | Added `search_vector` (`tb-search-core-entities-001`, 2026-08-08 — missed at ship time, caught by the same-day birds-eye audit that also caught DD-002/DD-007's identical gap). |
| 1.4.0 | 2026-08-10 | **Correction.** `authenticated`'s grant was table-wide, not column-scoped as the RLS-only description implied; `anon` held the identical default. Closed via `20260810240000_tier1_grant_lockdown.sql` (`tb-platform-grant-lockdown-001`). Correction to previously-inaccurate documentation, hence a minor bump per STD-002. |
