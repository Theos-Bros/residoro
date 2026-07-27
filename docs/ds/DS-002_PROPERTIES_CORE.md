# DS-002 — Properties (Core)

**Status:** Draft
**Version:** 2.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-07-27

---

## Purpose

Define the Property business entity as a residoro DS document, ahead of DD-002 and the SQL
migration that implements it. This document does not design the schema — it translates a
schema already decided in the Theos Registry (`cap-properties-001`) into residoro's own
documentation hierarchy, so residoro's own ADR→DS→DD→SQL order isn't skipped for a decision
that already exists elsewhere.

---

## Scope

Covers only the `properties` table itself — the physical property record (identity,
location, physical specs, ownership pointer, status). Originally, `Project`, `Developer`,
`PropertyMedia`, and `PropertyDocument` were all deferred to later milestones — pulling only the
bare `properties` table into this foundation slice was deliberate, just enough for
`tb-migration-preview-001` to write real rows.

**Update, 2026-07-27:** all four have since shipped. `Project`/`Developer`/`ProjectUnitType` are
covered by DS-007 (business rationale) and DD-007 (schema); `PropertyMedia`/`PropertyDocument`
by DS-008/DD-008. This document's scope remains the bare `properties` table only — it is not
being expanded to cover them, since each now has its own DS.

---

## Business Entity: Property

Source of truth for the full field list and design rationale: `cap-properties-001` (Theos
Registry, `theos-registry/registry/capabilities/cap-properties-001.md`), § Technical
Architecture → Data Models → `Property`, and § Key Design Decisions. Summarized here:

- A property's **ownership** (`owner_type`/`owner_id`) is modeled separately from any broker's
  right to market it (`cap-listings-001`'s Listing entity) — a property can have zero, one, or
  many listings over time without touching who owns it. This is `cap-properties-001`'s central
  modeling decision and this DS inherits it unchanged.
- `type` is one of eight PH-market property types (condo unit, house and lot, lot only,
  townhouse, commercial, warehouse, agricultural, industrial) — config-driven per
  `cap-properties-001` Key Design Decision 4, so new types are a migration + config addition,
  not a code change (see DD-002's "Type Choices" for how this is implemented as `CHECK`
  constraints rather than native Postgres enums, for exactly this reason).
- `verification_status` is a status flag only in this slice (`unverified` / `pending` /
  `verified` / `flagged`) — no verification workflow attached yet; that's
  `mil-properties-verification-001`.

---

## Deviations From `cap-properties-001` in This Slice

`cap-properties-001`'s schema references `project_id` (FK to `Project`) and `owner_id`
(polymorphic FK to `Developer` or a CRM Contact/Company). As of the original 2026-07-21
migration, neither `Project` nor any owner entity table existed, so `properties` was created
with `project_id` and `owner_id` as plain nullable/required UUID columns with no foreign key
constraint — exactly the non-breaking-later path this section anticipated.

**Update, 2026-07-27:** `project_id` now has a real FK (`projects` shipped, DS-007/DD-007).
`owner_id` still has no FK — it remains genuinely polymorphic (`developers` or `contacts`
depending on `owner_type`), which Postgres has no native FK support for; see DD-002's
Deviations section for the exact current state.

---

## Related Documents

- `cap-properties-001` (Theos Registry) — source of truth for the full Property schema and
  design rationale; this DS defers to it rather than re-deciding anything
- ADR-001 — Shared-Schema Multi-Tenant Architecture (this table's `tenant_id` column)
- ADR-002 — Workspace Isolation & Row-Level Security (this table's RLS policies)
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- DD-002 — Properties (implements this doc)
- DS-007 — Developers & Projects, DS-008 — Property Media & Documents (the entities originally deferred here)
- `mil-platform-foundation-001` (theos-registry) — the Registry milestone this implements

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial draft, written alongside DD-002 and the platform foundation migration. |
| 2.0.0 | 2026-07-27 | Refreshed from a birds-eye technical review: noted that Project/Developer/PropertyMedia/PropertyDocument, originally deferred here, have all since shipped with their own DS/DD docs; updated the `project_id` FK deviation note. Structural revision, hence major version bump per STD-002. |
