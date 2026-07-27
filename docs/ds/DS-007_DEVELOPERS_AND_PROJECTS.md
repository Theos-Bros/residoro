# DS-007 — Developers & Projects

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Define Developer, Project, and Project Unit Type as business entities — the developer/
pre-selling inventory hierarchy `cap-properties-001` always described but that shipped later
than the base Property entity. Written retroactively as part of a 2026-07-27 birds-eye review.

---

## Scope

Covers Developer, Project, and Project Unit Type. Does not cover Property itself (DS-002).

---

## Business Entities

### Developer

A deliberately minimal placeholder owner entity — just enough to unblock `Project.developer_id`
and, eventually, `Property.owner_id` when `owner_type = 'developer'`. `cap-properties-001`'s
Decision #2 always named this as temporary: it is explicitly intended to be superseded by a real
CRM Company record once that domain exists, not a considered permanent design.

Live-verification immediately ahead of this entity shipping (2026-07-27) found that despite
`cap-properties-001`'s Technical Architecture describing a `developers` table, it had never
actually been created — a proposed model that was never built until `tb-properties-project-001`
created it alongside `projects`, since `projects.developer_id`'s FK target had to exist first.

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
- `cap-properties-001` (Theos Registry) — full design rationale, including Decision #2 on Developer's placeholder status
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review covering three already-shipped tracer bullets. |
