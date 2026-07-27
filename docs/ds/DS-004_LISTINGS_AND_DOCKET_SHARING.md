# DS-004 — Listings & Docket Sharing

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Define Listing and Docket as business entities. Written retroactively as part of a 2026-07-27
birds-eye review — five tracer bullets shipped this domain (`tb-listings-create-001` through
`tb-listings-authority-expiry-notification-001`) with no DS ever written for it.

---

## Scope

Covers the Listing entity (marketing authority over a Property) and the Docket entity
(cross-brokerage sharing of a Listing). Does not cover Property itself (DS-002) or commission/
transaction handling (future capability, unbuilt).

---

## Business Entities

### Listing

`cap-properties-001`'s central modeling decision — ownership and marketing authority are
separate entities — is implemented here: a Property (DS-002) can carry zero, one, or many
Listings over its history, without the property record itself ever tracking who's marketing it.
`agent_id` is always the creating profile; there is no distinct Agent/Team-Lead role in the
platform's role model yet, so cross-agent reassignment isn't representable — reassigning a
listing means withdrawing the old row and creating a new one, not an update.

The lifecycle state machine (`draft → active → under_offer → sold | expired | withdrawn`) was
built incrementally: `tb-listings-create-001` shipped only `draft`/`active`/`withdrawn`, and
`tb-listings-lifecycle-001` widened it to the full set plus auto-expiry logic. Legal-transition
enforcement lives in application code, not a DB constraint or trigger — consistent with every
other status field in this schema (see DD-002's "Type Choices" rationale for `properties`).

**Exclusivity** (`exclusive`/`open`) mirrors the real Philippine brokerage practice of Authority
to Sell/Lease agreements. Enforcement defaults to a soft warning when a conflicting exclusive
listing already exists on the same property — never a hard block by default
(`cap-listings-001` Decision #2) — but `tb-listings-exclusivity-hardblock-001` added a
per-Workspace operator-set toggle (`exclusivity_hard_block`, DS-001) for brokerages that want
strict single-agent enforcement.

### Docket

The one entity in this schema whose entire purpose is a cross-tenant read: co-broking is
common in Philippine real estate practice but not organizationally affiliated in Residoro's
model — a broker voluntarily shares a specific Listing's details with a specific other
individual account (identified by `@handle`, not by any shared brokerage), and that share is
read-only for the recipient. `included_fields` is a live projection, not a data copy — a
docket always reflects the current state of the source listing rather than a point-in-time
snapshot, so a sharer changing the price or a listing's status is immediately visible to anyone
holding a docket for it. This was a deliberate decision (2026-07-23), not a default —
snapshotting was considered and rejected because a stale docket would misrepresent a listing a
recipient might act on.

Full co-listing (a recipient creating their own Listing against the shared property) is
explicitly out of scope for this slice — it would open cross-tenant exclusivity-conflict and
commission-split questions this schema doesn't resolve yet.

---

## Related Documents

- DD-006 — Listings & Docket Sharing (implements this doc)
- DD-001 — Workspaces & Profiles (`handle`, `exclusivity_hard_block`)
- DS-002 — Properties (Core) (the entity a Listing markets)
- `cap-listings-001` (Theos Registry) — full design rationale and Decisions this DS summarizes
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review covering five already-shipped tracer bullets. |
