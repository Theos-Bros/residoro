# DS-007 — Developers & Projects

**Status:** Draft
**Version:** 2.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-08-03

---

## Purpose

Define Project and Project Unit Type as business entities, plus the history of the Developer
entity `cap-properties-001` always described — the pre-selling inventory hierarchy that shipped
later than the base Property entity. Written retroactively as part of a 2026-07-27 birds-eye
review; the Developer section rewritten 2026-08-03 after Developer was superseded by Contact.

---

## Scope

Covers Developer, Project, and Project Unit Type. Does not cover Property itself (DS-002).

---

## Business Entities

### Developer — superseded 2026-07-28 by Contact (`is_company = true`)

Originally a deliberately minimal placeholder owner entity — just enough to unblock
`Project.developer_id` and, eventually, `Property.owner_id` when `owner_type = 'developer'`.
`cap-properties-001`'s Decision #2 always named this as temporary: it was explicitly intended to
be superseded by a real CRM Company record once that domain existed, not a considered permanent
design — which is exactly what happened, one day after this DS's initial version was written.

Live-verification immediately ahead of this entity shipping (2026-07-27) found that despite
`cap-properties-001`'s Technical Architecture describing a `developers` table, it had never
actually been created — a proposed model that was never built until `tb-properties-project-001`
created it alongside `projects`, since `projects.developer_id`'s FK target had to exist first.

**Superseded, 2026-07-28:** `tb-crm-developer-consolidation-001` (`cap-crm-001` Milestone 1)
retired the standalone Developer entity — every `developers` row became a `contacts` row with
`type = 'developer'`, `is_company = true` (same id preserved), and `Project.developer_id` now
points at `contacts`. Developer is no longer a distinct business entity; it's a Contact that
happens to be a company. See DS-005 (Contacts) and DD-007's "DROPPED" section for the mechanics.

### Project

Groups a developer's inventory (a condo building, a subdivision) so many individual `properties`
rows can share one parent record — name, location, unit count, construction status. Deliberately
scoped narrow at first: the original tracer bullet (`tb-properties-project-001`) shipped only
the entity and its link to `properties.project_id`, explicitly excluding bulk unit generation
and rollup views as separate follow-up work (see Project Unit Type below).

### Project Unit Type

Resolves a question `tb-properties-project-001` deliberately left open: pre-selling developers
sell by *unit type* (e.g. "1BR", "2BR", "Penthouse"), not by individually describing every unit
by hand. A Project Unit Type is a named template — size, bed/bath count, price — that bulk unit
generation then stamps out as ordinary `properties` rows, each linked back to its template via
`unit_type_id`. Create-only in v1: there's no update route, so correcting a wrong template means
creating a new one rather than editing the existing one in place — a deliberate scope decision,
not an oversight.

A separate, later follow-up (`tb-properties-project-rollup-001`) added `properties.unit_number`
— a free-form position label (floor+unit letter for condos, block+lot for subdivisions) — plus a
rollup view and admin-only bulk unit removal, none of which are part of this DS's scope (see
DD-002 for the column, DD-004... no — `unit_number` lives on `properties`, documented in DD-002).

---

## Related Documents

- DD-007 — Developers & Projects (implements this doc)
- DD-002 — Properties (`project_id`/`unit_type_id`/`unit_number` — the FK sources and rollup label)
- DS-002 — Properties (Core) (the entity this hierarchy attaches to)
- DS-005 / DD-005 — Contacts (Developer's successor entity, `is_company`)
- `cap-properties-001` (Theos Registry) — original design rationale, including Decision #2 on Developer's placeholder status
- `cap-crm-001` (Theos Registry) — Milestone 1, the Developer-into-Contact consolidation decision
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review covering three already-shipped tracer bullets. |
| 2.0.0 | 2026-08-03 | Developer entity superseded by Contact (`is_company`) the day after this doc's initial version — rewrote that section as a historical record instead of a live entity description. Structural revision (entity removed), hence major version bump per STD-002. |
