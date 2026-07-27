# DD-005 — Contacts

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

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
| `notes` | `text` | nullable | |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | Nullable, same rationale as `properties.created_by` — bulk/service-role writes may not have a single acting user |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

Index: `idx_contacts_tenant_id` on `(tenant_id)`.

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

`authenticated` is granted `select, insert, update, delete`. `service_role` has full access —
as with every other tenant-scoped table, the backend currently uses `service_role` for all
`contacts` routes (see ADR-002's "Superseded By (partial)" note and ADR-003).

---

## Related Documents

- DD-002 — Properties (parallel table shape and RLS pattern)
- DD-004 — Import Batches & Row Tracking (`imported_contacts`, the migration write-tracking sibling)
- `cap-migration-001` (Theos Registry) — generic Contact entity decision, scoped for migration purposes
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260722140000_contacts.sql` — implements this doc

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review. |
