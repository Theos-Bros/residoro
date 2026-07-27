# DS-008 — Property Media & Documents

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Define Property Media (photos) and Property Document (title/tax records) as business entities —
the media/documents infrastructure `cap-properties-001` always described but that shipped later
than the base Property entity, and the first use of Supabase Storage in residoro. Written
retroactively as part of a 2026-07-27 birds-eye review.

---

## Scope

Covers Property Media and Property Document. Does not cover Property itself (DS-002) or the
photo-gallery/document-list UI behavior (application concern — a TS/TDD document).

---

## Business Entities

### Property Media

A property's photo gallery. Deliberately scoped to photos only in this slice — the `type`
column is a single-value constraint (`'photo'`), not an open set, so widening to floor
plans/video is an explicit future decision rather than something silently possible today.
Introduces Supabase Storage as a mechanism for the first time in this codebase: the CSV
migration pipeline (DS-003) stores its raw file as `text` in Postgres instead, a pattern that
doesn't transfer to binary images at any reasonable scale. Storage access is private by design
— the frontend never gets a permanent public URL, only short-lived signed URLs the backend
generates on each read, matching this app's tenant-isolation posture rather than treating media
as public-internet-readable.

### Property Document

Title deeds, tax declarations, and other supporting paperwork. Kept as a separate table and
Storage bucket from Property Media rather than a shared "attachments" table, because the two
have genuinely different access/mutability shapes: documents have no cover-photo/sort-order
concept (they're a flat list, not a gallery), and — a deliberate decision, not an omission — are
immutable once uploaded; correcting a wrong `document_type` means deleting and re-uploading, not
editing in place. Access is resolved as tenant-wide (any authenticated user in the Workspace,
not just the uploader or admins), a decision made explicitly during this tracer bullet's scoping
rather than inherited by default from Property Media's pattern.

---

## Related Documents

- DD-008 — Property Media & Documents (implements this doc)
- DS-002 — Properties (Core) (the entity these attach to)
- DS-003 — Migration Temp Files (the earlier, different pattern — raw content in Postgres — this domain deliberately departs from)
- `cap-properties-001` (Theos Registry) — full design rationale
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review covering two already-shipped tracer bullets. |
