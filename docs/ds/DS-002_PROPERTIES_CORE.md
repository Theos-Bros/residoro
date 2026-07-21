# DS-002 — Properties (Core)

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-07-21

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
location, physical specs, ownership pointer, status). Does **not** cover: `Project` (developer
inventory grouping), `Developer` (placeholder owner entity), `PropertyMedia`, or
`PropertyDocument` — all four are part of `cap-properties-001`'s full schema but are deferred
to later milestones (`mil-properties-core-001`, `mil-properties-projects-001`,
`mil-properties-media-001`, `mil-properties-verification-001` in the Registry), consistent with
CTX-006's roadmap, which reserves Property Verification/Media/Documents/Listings for Phase 3.
Pulling only the bare `properties` table into this foundation milestone is a deliberate,
minimal slice — just enough for `tb-migration-preview-001` to write real rows.

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
(polymorphic FK to `Developer` or a CRM Contact/Company). Neither `Project` nor any owner
entity table exists yet — both stay out of scope for this foundation milestone. `properties`
is created with `project_id` and `owner_id` as plain nullable/required UUID columns with **no
foreign key constraint**, so the column shapes match the eventual schema and no data
migration is needed later — only an `ALTER TABLE ... ADD CONSTRAINT` once the referenced
tables exist. See DD-002 for the exact column definitions.

---

## Related Documents

- `cap-properties-001` (Theos Registry) — source of truth for the full Property schema and
  design rationale; this DS defers to it rather than re-deciding anything
- ADR-001 — Shared-Schema Multi-Tenant Architecture (this table's `tenant_id` column)
- ADR-002 — Workspace Isolation & Row-Level Security (this table's RLS policies)
- DD-002 — Properties (implements this doc)
- `mil-platform-foundation-001` (theos-registry) — the Registry milestone this implements

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial draft, written alongside DD-002 and the platform foundation migration. |
