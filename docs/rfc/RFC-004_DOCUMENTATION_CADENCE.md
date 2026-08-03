# RFC-004 — Documentation Cadence: Per-Tracer-Bullet vs. Periodic Catch-Up

**Status:** Approved
**Version:** 1.1.0
**Owner:** Residoro Engineering
**Created:** 2026-08-03
**Last Updated:** 2026-08-03

---

## Purpose

Decide how residoro's own documentation-first order (CTX → ADR → STD → BPM → CAP → DS → DD →
TS → SQL → Application, per `docs/README.md`) actually gets kept current once schema and
capability work ships — as a per-tracer-bullet Definition-of-Done requirement, or as periodic
birds-eye catch-up reviews, as has happened twice now.

---

## Scope

Applies to `docs/ds/` (business entities) and `docs/dd/` (tables/columns/constraints) staying
current with `supabase/migrations/`, and to Theos Registry capability docs' `relationships`
frontmatter staying current with shipped tracer bullets. Does not cover CTX/ADR/RFC cadence —
those are written at decision-time by nature (a CTX/ADR/RFC doc *is* the decision record, there's
no "shipped code" for it to lag behind) and aren't the pattern this RFC is about.

---

## Related Documents

- `docs/README.md` — states the CTX→ADR→STD→BPM→CAP→DS→DD→TS→SQL→Application order this RFC is
  about actually enforcing
- DS-001 through DS-009, DD-001 through DD-009 — all written retroactively in the 2026-07-27
  birds-eye review, several already stale again by 2026-08-03 (see Context)
- `../theos-registry/CLAUDE.md` — the tracer-bullet-first workflow this RFC's Decision would add
  a DoD step to

---

## Context

The 2026-07-27 birds-eye review wrote DS-001 through DS-009 and DD-001 through DD-009
retroactively, closing a gap where tracer bullets had shipped schema with no corresponding
business-entity or data-dictionary doc. That review's own framing (per multiple DS docs' Purpose
sections) was explicit: this was catch-up work, done because no DS/DD had ever been written
for those tables at ship time.

A second birds-eye review, one week later (2026-08-03), found the same pattern recurring at
higher volume: 9 new tables (`inquiries`, `buyer_requirements`, `buyer_requirement_matches`,
`workspace_matching_settings`, `tasks`, `workspace_task_routing_settings`,
`settings_edit_delegations`, `workspace_sharing_settings`, `workspace_performance_settings`,
`listing_share_events`) shipped across roughly fifteen tracer bullets with zero DS/DD coverage.
One capability (`cap-brokerage-permissions-001`) has never had any DS doc at all. Existing DD
docs went stale in-place: DD-002 described `properties.owner_id` as having "no FK" eight days
after a migration added one; DD-007 described a `developers` table as live six days after it was
dropped; DD-006 claimed "service_role for all routes" a week after that stopped being true.

The most consequential instance found: DD-001's Signup Provisioning section described the exact
`handle_new_user()` implementation that a CRITICAL security fix (2026-07-29,
`docs/security-review-2026-07-29.md`) replaced — as if it were still current — for the five days
between the fix shipping and this review catching it. A reader trusting that doc during that
window would have believed a patched privilege-escalation hole was still open. This is
qualitatively different from ordinary staleness: an authoritative-looking doc that's actively
wrong is worse than no doc at all, because it's trusted.

Separately, three Theos Registry capability docs had `relationships` frontmatter that fell
behind their own body prose — in one case (`cap-buyer-leads-001`), the doc's own body already
flagged the gap in writing ("this section is stale beyond TB4... flagging rather than silently
reconstructing") without the frontmatter ever being corrected to match.

---

## Decision: Documentation Cadence Going Forward

| Option | Pros | Cons |
|---|---|---|
| **Per-tracer-bullet DoD requirement** *(Recommended)* — any tracer bullet that adds, drops, or changes a table/column/RLS policy must update the relevant DD (and DS, if the business entity itself changed) before the tracer bullet is considered done; any tracer bullet must add its own ID to the relevant capability's `relationships` array as part of the same DoD step. Scoped narrowly: a short, dated addition/correction to the existing doc, not a full rewrite each time. | Closes the gap at the source — this is already what `docs/README.md`'s stated order implies, so this isn't new policy, it's enforcing existing policy. Prevents the "authoritative doc describes a patched vulnerability as current" failure mode entirely, since the doc update happens in the same unit of work as the fix. Cheap per-instance (one dated note, not a rewrite) since it never has to catch up on a backlog. | Adds a small amount of friction to every schema-touching tracer bullet — on a high-velocity day (2026-07-28 shipped 9 tables), this is 9 small doc edits instead of 0. Relies on the tracer-bullet author (human or AI) actually doing it — no automated enforcement, so a rushed tracer bullet can still skip it (though the cost of skipping is now one missed edit, not nine). |
| **Status quo — periodic birds-eye catch-up only** | Zero added friction on any individual tracer bullet; ships as fast as it does today. The two catch-up reviews so far produced accurate, well-grounded docs (verified against actual migrations/code, not just prose). | This is the second time the same gap has recurred in one week of higher-velocity shipping — the pattern doesn't self-correct, it recurs at whatever cadence review happens to run. The DD-001 incident (a security-relevant doc describing a patched vulnerability as current) shows the failure mode isn't just "slightly out of date," it's "actively wrong and trusted" for however long the gap between reviews happens to be. Cost scales with backlog size — this review's catch-up touched 7 docs; the next one, at the same shipping velocity, touches more. |
| **Automated gate** — a script/CI check that fails a build or blocks a merge if a migration adds/drops a table with no corresponding reference in `docs/dd/` | Removes reliance on remembering entirely; catches drift the moment it would occur, not whenever the next review happens. | Real engineering investment to build (no CI exists in this repo at all yet, per the infra survey — see the separate infra-readiness RFCs); a purely mechanical check can only verify a DD file *mentions* a table name, not that the description is actually accurate, so it doesn't fully close the DD-001-style "wrong, not just missing" failure mode either. Likely premature before CI itself exists. |

**Recommendation:** Per-tracer-bullet DoD requirement, scoped narrowly (a short dated note, not
a full rewrite). This is the option that actually prevents the DD-001 failure mode — an
authoritative doc silently describing a fixed vulnerability as live — rather than just bounding
how long it can persist before the next review happens to catch it. It also isn't really new
process: `docs/README.md`'s own stated order already puts DS/DD before SQL; this decision is
choosing to enforce that order going forward rather than let it lapse into "eventually, via
review" by default.

**Decision:** Per-tracer-bullet DoD requirement, as recommended. Any tracer bullet that adds,
drops, or changes a table/column/RLS policy updates the relevant DD (and DS, if the business
entity itself changed) before the tracer bullet is considered done, scoped to a short dated
note/correction rather than a full rewrite. Any tracer bullet also adds its own ID to the
relevant capability's `relationships` array as part of the same DoD step.

**Follow-up, done same day:** added to `../theos-registry/CLAUDE.md`'s "Working in this repo"
list as a DoD requirement, so it isn't left as a decision recorded here but unenforced anywhere
a future tracer bullet would actually see it.

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-08-03 | Initial draft, from the 2026-08-03 birds-eye review's findings. |
| 1.1.0 | 2026-08-03 | Approved — per-tracer-bullet DoD requirement, as recommended. |
