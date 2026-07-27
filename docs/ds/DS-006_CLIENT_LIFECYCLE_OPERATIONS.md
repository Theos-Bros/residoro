# DS-006 — Client Lifecycle Operations

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Define the business entities behind `cap-client-lifecycle-001`'s contract enforcement and
training tracking — how a Workspace's contract state actually gets enforced over time, not just
recorded. Written retroactively as part of a 2026-07-27 birds-eye review — five tracer bullets
shipped this domain with no DS ever written for it.

---

## Scope

Covers Contract Notification and Training Session as business entities, and the
contract-lifecycle enforcement mechanism layered onto the Workspace entity (DS-001). Does not
cover the enrollment form/flow itself (application behavior — a TS/TDD concern) or billing/
invoicing (explicitly out of scope for `cap-client-lifecycle-001` — no online payment exists).

---

## Business Entities

### Contract Lifecycle (on Workspace)

`cap-client-lifecycle-001`'s Decision — Residoro is contract-based, not subscription-based —
means access has to be actively enforced against a stored end date, not left to a payment
provider's own lapse handling. The mechanism: a daily automated check (not a real-time trigger)
compares every Workspace's `contract_end_date` against the current date and moves it through
three states — `active` (normal) → `read_only` (past end date, within a 7-day grace period:
writes blocked, reads and data export still allowed) → `blocked` (grace period elapsed, login
itself rejected). Warnings fire at 30/7/1 days before expiry, each idempotent (fires at most
once per contract period, tracked via a `sent_at` timestamp cleared on renewal).

**Why an Edge Function + `pg_cron`, not a DB trigger:** the only existing precedent for "real
logic in SQL" in this schema (`handle_new_user()`) was treated by its own authors as an
uncomfortable exception, not a pattern to grow. Contract enforcement's actual logic — email
sending, multi-tier warning state, access-state transitions — lives in TypeScript in a Supabase
Edge Function, with SQL reduced to a thin daily dispatcher. This same architecture was reused
as-is for Listing authority-expiry warnings (DS-004) and training reminders (below) rather than
inventing a second pattern.

### Contract Notification

A side-panel-visible record of a warning that fired, persisted (not just emailed) so a
brokerage admin logging in later still sees it, until explicitly dismissed. Exists because an
email can be missed; the in-app notification is the durable record of "you were warned."

### Training Session

Every enrolled client has two contractual training sessions (2-day each, one month apart) —
tracked as real Residoro data (scheduled date, completion status) rather than left to an
operator's personal calendar, per the user's explicit requirement that training be taken as
seriously as contract-expiry tracking. No scheduling/booking UI exists — an operator manually
enters agreed dates. A single reminder email fires 3 days before each session's scheduled date,
reusing the same Edge-Function-owns-logic architecture described above.

---

## Related Documents

- DD-001 — Workspaces & Profiles (`access_state`, `warning_*_sent_at`, `contract_notifications` table)
- DD-009 — Training Sessions
- DS-001 — Platform Foundation: Identity & Workspace (the Workspace entity this lifecycle attaches to)
- DS-004 — Listings & Docket Sharing (the same Edge-Function+`pg_cron` architecture reused for authority-expiry)
- `cap-client-lifecycle-001` (Theos Registry) — full design rationale (invite-only, contract-based, high-touch model)
- ADR-001 — Shared-Schema Multi-Tenant Architecture

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review covering five already-shipped tracer bullets. |
