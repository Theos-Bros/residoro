# RFC-005 — Hosting & Deployment Plan Reconciliation

**Status:** Approved
**Version:** 1.1.0
**Owner:** Residoro Engineering
**Created:** 2026-08-09
**Last Updated:** 2026-08-09

---

## Purpose

Reconcile two unreconciled deployment plans found by a 2026-08-09 birds-eye audit: RFC-001's
**Approved** hosting decision (Vercel + Render/Fly.io, 2026-07-27) and `cap-deployment-001`'s
(Theos Registry) newer plan (Cloudflare Pages + Render/Railway, drafted 2026-08-08) — scoped in a
separate session that never checked `docs/rfc/` first. This RFC does not rewrite RFC-001's or
RFC-003's decision records; it supersedes specific decisions explicitly, with a pointer left on
each superseded record, per this repo's own convention for reversed decisions (see
`cap-buyer-leads-001`'s Decision #2 for precedent).

---

## Scope

Covers: which hosting platforms to actually use (frontend + backend), and whether the Supabase
project migration (RFC-003) happens as a clean cutover bundled with this hosting work, or is
skipped in favor of upgrading the current prototype project in place. Two threads the audit
found *look* like conflicts but resolve automatically once those two are decided — covered here
as confirmations, not fresh decisions: staging environment sequencing (RFC-001 Decision 2) and
observability/Sentry timing (RFC-001 Decision 3). Backup/DR (RFC-003 Decision 4) is contingent on
the Supabase-path decision below and confirmed, not re-opened.

---

## Related Documents

- RFC-001 — Pre-Scaling Infrastructure Readiness (Decision 1 superseded by this RFC's Decision 1
  if a different platform is chosen; Decisions 2–4 confirmed/re-affirmed below, not reopened)
- RFC-003 — Supabase Project Migration Plan (Decision 1's timing trigger is this RFC's Decision 2)
- `theos-registry` — `cap-deployment-001` (the newer plan this RFC reconciles against RFC-001)
- ADR-001 — Shared-Schema Multi-Tenant Architecture

---

## Context

A 2026-08-09 birds-eye audit, triggered by noticing `cap-deployment-001` never referenced
RFC-001 or RFC-003, confirmed the divergence is a real oversight, not a documented pivot:

- `cap-deployment-001`'s own Notes state it was "a same-session capture of real research... not a
  planned capability" — scoped fresh from a direct user question about cost/capacity, without
  cross-checking `docs/rfc/`.
- Its own Decision 1 states "no other platform (AWS/GCP/Fly.io) was evaluated" — Fly.io is half
  of RFC-001's own already-Approved recommendation, listed here as simply unconsidered, not
  compared and rejected.
- `git log` between RFC-001's approval (2026-07-27) and `cap-deployment-001`'s scoping
  (2026-08-08) contains no commit touching hosting/deploy config and no revision to RFC-001 or
  RFC-003.
- `cap-deployment-001` is the only one of the two plans with real cost/capacity numbers
  (~$33–36/mo, ~300–500+ team headroom, computed against Residoro's actual schema) — RFC-001's
  Decision 1 never priced its own recommendation.
- `cap-deployment-001` says the Supabase project should go "Free → Pro" with no mention of a new
  project, RFC-003, or a migration — reading as upgrading the *existing* "Residoro Prototype"
  project (`skfnrcwqvmurnpwrmixj`) in place, silently diverging from RFC-003's clean-cutover plan.

---

## Decision 1: Hosting Platform

Blocks everything else below — same dependency structure RFC-001 itself already established.
RFC-001's original three-option framing (Vercel+Render/Fly.io vs. single VPS vs. fully
serverless) never priced any option. This RFC re-ran the comparison with real, sourced numbers
before deciding (2026-08-09 research, see below) rather than resolving it on the original
options' unpriced pros/cons alone.

**Frontend — Vercel Pro vs. Cloudflare Pages (free):**

| | Vercel Pro ($20/mo/seat) | Cloudflare Pages (free) |
|---|---|---|
| Commercial use | Hobby (free) tier explicitly **prohibits** commercial use per Vercel's own fair-use docs ("the Hobby plan restricts users to non-commercial, personal use only") — Residoro is a paid multi-tenant SaaS, so Pro is mandatory, not optional | Free tier explicitly **allows** commercial use; only restriction is video/large-file hosting, irrelevant to a Vite/React SPA |
| Cost | $20/mo minimum, per seat | $0/mo |
| DDoS/security | Basic on Pro; full WAF/bot management gated behind Enterprise | Full Cloudflare security stack (DDoS mitigation, WAF, bot management) included free on every tier |
| Edge network | ~30 locations | 300+ locations |
| Framework fit | Best-in-class DX is Next.js-specific (ISR, edge middleware patterns) — doesn't apply to a plain Vite/React SPA | No framework-specific disadvantage for a plain SPA |

**Backend — Render vs. Railway vs. Fly.io:**

| | Render Starter ($7/mo flat) | Railway Hobby ($5/mo + usage) | Fly.io (no free tier since 2024) |
|---|---|---|---|
| Real-world cost | $7/mo, predictable | $5–20/mo, usage-based (harder to forecast) | $8–25/mo realistic for a small always-on app with egress |
| Regions | 5, single-region-focused | ~4, not multi-region-focused | 35+, built for global edge placement |
| Scaling | Single-region autoscale, no scale-to-zero on paid tiers | No scale-to-zero | True scale-to-zero (300ms–2s cold start) |
| Fit for Residoro today | Matches actual current scale — B2B staff-scale traffic, single-region, per `cap-deployment-001`'s own capacity research ("tens to low-hundreds of teams" before a compute-tier upgrade matters) | Comparable capability to Render, no advantage, less predictable billing | Solves a global-scale/scale-to-zero problem Residoro doesn't have yet, at a real cost premium |

| Option | Pros | Cons |
|---|---|---|
| **A — Keep RFC-001's plan: Vercel (frontend) + Render/Fly.io (backend)** | Already formally Approved; Render/Fly.io's Fastify-compatibility was already confirmed against the actual code (`PORT` env var, `0.0.0.0` bind) | Real cost is ~$27–45/mo (Vercel Pro $20/mo/seat + backend $7–25/mo) — RFC-001 never disclosed this because it implicitly assumed Vercel's free tier, which turns out not to be legally usable for this product |
| **B — Adopt `cap-deployment-001`'s plan: Cloudflare Pages + Render** *(Recommended, Decided)* | ~$7/mo total hosting cost; Cloudflare Pages' free tier is the only frontend option actually usable on its free tier for a commercial product; wins on cost, commercial-use eligibility, and security posture with no offsetting downside for a plain Vite/React SPA at Residoro's current scale | Fly.io's real capability advantage (global edge, scale-to-zero) is left on the table — acceptable now, revisit if multi-region latency becomes a real, observed complaint |
| **C — Hybrid: Vercel (frontend) + Render/Railway backend research** | Preserves RFC-001's one formal frontend decision | Same undisclosed cost problem as Option A; doesn't actually solve anything Option A doesn't |

**Recommendation:** B. It is the only option grounded in real, sourced numbers (Vercel's own
docs, current 2026 provider pricing) rather than the original RFC-001 framing's unpriced
description of what a natural fit might look like.

**Decision:** B — **Cloudflare Pages (frontend) + Render (backend)**, as recommended. Railway is
not chosen over Render (comparable capability, less predictable usage-based billing, no offsetting
advantage at Residoro's current scale). Fly.io remains a documented future option, not rejected
outright — revisit only if a concrete signal of multi-region latency demand shows up, mirroring
RFC-001's own "defer, don't reject" framing for its single-VPS option.

---

## Decision 2: Supabase Project Path

| Option | Pros | Cons |
|---|---|---|
| **A — RFC-003's plan: clean cutover to a new Supabase project, bundled with this hosting work** *(Recommended)* | Already formally Approved; the only path that closes the legacy-service-role-key blocker on the three (now four) `pg_cron` Edge Functions for good, from day one on the new project; zero data-loss cost already confirmed — every account on the current project is a manual QA/verify seed account, nothing worth preserving | More upfront work than Option B — recreate schema from 27 versioned migration files, re-point DNS/env vars, redeploy 4 Edge Functions with fresh secrets |
| **B — `cap-deployment-001`'s implicit plan: upgrade the existing "Residoro Prototype" project Free → Pro in place** | Zero migration effort — a single dashboard action; immediately removes the Free-tier inactivity-pause/2-project-cap constraint `cap-deployment-001` itself flags as a Pro-tier requirement | Never actually chosen as a decision anywhere — `cap-deployment-001` doesn't mention RFC-003, a new project, or a migration at all, so this reads as an oversight, not a considered tradeoff; leaves the legacy-key Edge Function blocker (a separately tracked, real constraint) unresolved and now with no natural trigger point left to close it against; the live project is still literally named "Residoro Prototype" going into real client onboarding |

**Recommendation:** A. It is the only option that closes a real, separately-tracked blocker
(legacy-key Edge Functions) as a side effect of work that has to happen anyway, and it was
already a considered, Approved decision — Option B was never actually decided, just defaulted
into by omission.

**Decision:** A — RFC-003's clean cutover to a new Supabase project, as recommended, bundled with
this RFC's Decision 1 hosting work. RFC-003 itself is not reopened or rewritten; this confirms
its plan executes as already recorded, now that Decision 1 gives it the concrete hosting cutover
to bundle with.

---

## Confirmations (not fresh decisions — resolve automatically from Decisions 1–2 above)

**Staging environment (RFC-001 Decision 2, Approved — not reopened):** RFC-001 already decided
to defer full staging and write a manual deploy runbook now, revisiting "once the planned
Supabase project migration has a date." `cap-deployment-001`'s TB2 (second free Supabase project
+ second free backend + Cloudflare Pages branch preview, ~$0/mo) isn't a contradiction — it's a
concrete zero-cost *shape* for the same deferred thing, just missing the runbook RFC-001 asked
for in the meantime. With Decision 2 = A confirmed, the Supabase migration now has the date
RFC-001 was waiting for — staging can be scoped for real as part of that same work, using
`cap-deployment-001`'s TB2 shape. The manual deploy runbook should still be written now,
independent of that timing, since RFC-001 never conditioned it on anything.

**Observability / Sentry (RFC-001 Decision 3, Approved — not reopened):** RFC-001 already decided
to wait until hosting exists, then wire Sentry. `cap-deployment-001` doesn't override this — it
just doesn't mention it. Once Decision 1's hosting actually ships, RFC-001's own trigger
condition fires; Sentry wiring becomes a natural next step, not a fresh decision.

**Backup / DR (RFC-003 Decision 4, Approved — not reopened):** RFC-003 already decided to defer
backup/DR policy to the planned Supabase migration itself, flagging that the next revisit needs
an explicit trigger rather than drifting open-ended again. With Decision 2 = A confirmed, this
migration *is* that trigger — the new project's backup/PITR posture gets decided as part of its
setup, per RFC-003's own plan, executing as already recorded.

---

## Pointer: Effect on RFC-001 and RFC-003

Decision 1 resolved to Option B, so **RFC-001's Decision 1 is superseded by this RFC's Decision
1.** RFC-001 itself is not rewritten — its original Decision 1 text stays as the historical
record of what was approved 2026-07-27 and why; a pointer noting the supersession (with the date
and the reason: real pricing showed Vercel's free tier isn't usable for a commercial product) is
added directly below it. RFC-003's Decision 1 (timing, "bundled with RFC-001's hosting cutover")
is **not superseded** — Decision 2 above confirmed RFC-003's plan executes as-is; only its
cross-reference is updated to point at this RFC's Decision 1 instead of RFC-001's, since the
timing logic itself (bundle with whichever hosting cutover actually happens) is unaffected by
which specific platform was chosen.

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-08-09 | Initial draft, from the 2026-08-09 birds-eye audit's infra/deployment findings. |
| 1.1.0 | 2026-08-09 | Approved. Decision 1: Cloudflare Pages + Render, after live-sourced 2026 pricing/feature research (Vercel Hobby's commercial-use ban confirmed directly from Vercel's own docs; Render/Railway/Fly.io compared on cost, regions, and scaling fit against Residoro's actual current scale). Decision 2: RFC-003's clean-cutover plan confirmed, bundled with Decision 1's hosting work. Staging/observability/backup-DR confirmed as already-decided, now-actionable per RFC-001/RFC-003. |
