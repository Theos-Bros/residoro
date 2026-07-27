# DS-005 — Contacts

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Define Contact as a business entity. Written retroactively as part of a 2026-07-27 birds-eye
review — `tb-migration-contacts-001` shipped this domain with no DS ever written for it.

---

## Scope

Covers the bare Contact entity as scoped for migration purposes only. Does not cover a full CRM
domain (lead pipelines, agent assignment, activity history, relationship-to-property beyond the
raw entity) — that remains explicitly future work, not started.

---

## Business Entity: Contact

A generic person/organization record — buyer lead, co-broker, developer contact, property
owner, and so on — introduced specifically to give CSV-migrated contact data somewhere to land
(`cap-migration-001`'s "zero-trust migration" principle applies to a brokerage's contacts, not
just their properties). `type` is deliberately an open text field rather than a fixed enum: at
the time this entity was designed, the real vocabulary of contact types a brokerage would
actually use wasn't known well enough to commit to a closed list — unlike `properties.type`,
which draws from a well-understood, stable set of eight Philippine market property types (DD-002
"Type Choices"). Revisit once real client data shows what values actually appear.

Contact is intentionally the smallest entity that unblocks migration and export — it is not a
CRM. No lead status, no assignment, no activity history. A full CRM domain (referenced in
CTX-002) remains a distinct, later concern.

---

## Related Documents

- DD-005 — Contacts (implements this doc)
- DD-004 — Import Batches & Row Tracking (`imported_contacts`, the migration write-tracking sibling)
- DD-002 — Properties (the `properties.type` design this entity's `type` field deliberately diverges from)
- `cap-migration-001` (Theos Registry) — the migration capability this entity was built to support
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review. |
