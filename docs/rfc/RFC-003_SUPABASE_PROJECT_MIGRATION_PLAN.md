# RFC-003 — Supabase Project Migration Plan

**Status:** Approved
**Version:** 1.2.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-08-09

---

## Purpose

Turn the previously-planned-but-unscheduled move off the prototype Supabase project ("Residoro
Prototype", ref `skfnrcwqvmurnpwrmixj`) into an actual plan: when it happens, what "migration"
concretely means given there's likely no real client data to carry forward yet, and how it
closes two gaps already found by this review — the cron Edge Functions' dependency on legacy
service-role auto-injection, and the backup/DR decision RFC-001 deliberately deferred here.

---

## Scope

Covers: migration trigger/timing, cutover strategy, service-role secret handling in the new
project, and backup/DR posture for the new project. Does **not** cover Auth SMTP/custom domain
configuration — that's a separate, still-open dependency (no domain has been chosen yet) that
this migration doesn't have to resolve, only avoid making harder.

---

## Related Documents

- RFC-001 — Pre-Scaling Infrastructure Readiness (deferred backup/DR and staging to this plan;
  its Decision 1 was superseded 2026-08-09 by RFC-005 — see the note on Decision 1 below)
- RFC-002 — RLS Enforcement vs. Trusted-Backend-Only (the scoped-client work should land before
  or alongside this migration, not after — see Decision 1)
- RFC-005 — Hosting & Deployment Plan Reconciliation (2026-08-09; confirmed this RFC's plan
  executes as-is, and is now the RFC this migration's timing bundles with instead of RFC-001)

---

## Context

The current Supabase project is a prototype: every account in it appears to be a manually
seeded QA/verification account (`application/backend/src/scripts/create-operator.ts` and six
`create-*-verify-account.ts` scripts, one per tracer bullet that needed live verification), not
real brokerage data. A move to a fresh project has been planned for a while but not scheduled,
originally framed as happening "once core prototype features are done." Independently, this
review found:

- All three cron Edge Functions depend on the platform's legacy service-role key
  auto-injection (`Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`, never explicitly set via
  `supabase secrets set`) — this is what currently blocks disabling legacy API keys
  project-wide, on *this* project.
- No backup/DR policy exists for the current project (RFC-001, Decision 4, deferred this
  question here on the assumption real client data won't land before this migration happens).
- RFC-001 also flagged the new project as "a natural point to also stand up staging, rather
  than building staging twice."

---

## Decision 1: Trigger / Timing

| Option | Pros | Cons |
|---|---|---|
| **Bundle with hosting setup (RFC-001)** *(Recommended)* — do the Supabase migration at the same time as standing up Vercel + Render/Fly.io, since both involve touching every environment variable and redeploying everything anyway | One coordinated cutover instead of two separate ones touching overlapping config; matches RFC-001's own note that the new Supabase project is "a natural point to also stand up staging" | Ties this migration's timing to RFC-001's hosting work being scheduled, which doesn't have a date yet either |
| **Now, independent of hosting** | Closes the legacy-key/backup-DR gaps immediately, doesn't wait on an unrelated decision | Means touching Supabase env vars twice — once now, again when hosting moves off local/current setup — more total disruption than one coordinated pass |
| **Wait for a specific feature/business milestone** (e.g. first real client signed) | Migration happens exactly when it's actually needed, no earlier | Given the legacy-key blocker and undocumented backup posture already exist *today* on the current project, waiting leaves both gaps open for an unspecified, possibly long, period |

**Recommendation:** Bundle with the hosting setup from RFC-001. Both are "touch every
environment's config once" events — doing them together is less total disruption than two
separate cutovers, and RFC-001 already anticipated this.

**Decision:** Bundle with RFC-001's hosting setup, as recommended. No independent date — this
migration is now scheduled to happen alongside the Vercel + Render/Fly.io cutover.

**Note, 2026-08-09 (RFC-005):** RFC-001's Decision 1 (Vercel + Render/Fly.io) was superseded by
RFC-005's Decision 1 (Cloudflare Pages + Render). This Decision's substance is unaffected — bundle
with "whichever hosting cutover actually happens" was always the operative logic — only the
cross-reference changes: this migration now bundles with RFC-005's hosting work, which RFC-005's
own Decision 2 explicitly confirmed.

---

## Decision 2: Cutover Strategy

| Option | Pros | Cons |
|---|---|---|
| **Clean cutover** *(Recommended)* — recreate schema from the 26 versioned migration files (`supabase db push` against the new project), recreate pg_cron jobs + Vault secrets, redeploy the 3 Edge Functions, redeploy frontend/backend pointed at new project URLs. No data carried forward. | Simple, low-risk — the schema is already fully captured in version-controlled migration files, so this is closer to "run migrations on a fresh database" than a real migration; nothing to reconcile or dedupe | Loses whatever's currently in the prototype project — only acceptable if that data is genuinely disposable QA data, not something worth keeping (e.g. for demos) |
| **Data-preserving migration** (`pg_dump`/`pg_restore` or Supabase's project migration tooling, carrying existing rows forward) | Nothing is lost | Meaningfully more engineering work for data that, as far as this review can tell, is all QA/verification-account data — worth confirming that assumption is actually correct before ruling this out |

**Recommendation:** Clean cutover — but this depends on confirming the current project genuinely
has nothing worth preserving (no demo data used for pitches, no long-lived QA accounts anyone
still depends on). Flagging as the one factual question this RFC can't answer itself.

**Decision:** Clean cutover, confirmed — nothing in the current prototype project is worth
carrying forward. Recreate schema from the 26 versioned migration files, no data migration
tooling needed.

---

## Decision 3: Service-Role Secret Handling in the New Project

| Option | Pros | Cons |
|---|---|---|
| **Explicit `supabase secrets set` for the service-role key in the new project, not platform auto-injection** *(Recommended)* | Decouples the 3 cron Edge Functions from legacy-key status entirely — closes the migration-blocker (previously: "can't disable legacy API keys project-wide until these are migrated off it") for good, on the new project, from day one | One extra explicit setup step per Edge Function deploy, instead of relying on the platform doing it automatically |
| **Keep relying on platform auto-injection in the new project too** | No change to how the Edge Functions currently work — copy-paste redeploy | Recreates the exact same blocker on the new project that exists on the current one; the whole point of this migration is to leave known gaps behind, not carry them forward |

**Recommendation:** Explicit `supabase secrets set`. This is the cheapest possible fix given
it's happening during a full redeploy anyway, and it's the one item on this list that fully
closes a known, named blocker rather than just relocating it.

**Decision:** Explicit `supabase secrets set` for the service-role key on the new project, as
recommended. This closes the legacy-key/cron-function dependency for good — it does not carry
forward to the new project.

---

## Decision 4: Backup / DR Posture for the New Project

RFC-001 (Decision 4) deferred this exact question to this migration.

| Option | Pros | Cons |
|---|---|---|
| **Enable Supabase's Point-in-Time Recovery (PITR) on the new project from day one** *(Recommended)* | Real recovery capability before any real client data exists on it — the cheapest time to turn this on is before there's anything to lose | Requires a paid Supabase tier (PITR is not available on the free tier) — a real cost decision, not just a config toggle |
| **Rely on Supabase's default daily backups only (whatever tier-appropriate default applies), decide on PITR later** | No immediate cost decision | Coarser recovery point (up to 24h of data loss in a worst case) than PITR; "decide later" is exactly the pattern that left the current project's backup posture undocumented in the first place |

**Recommendation:** Enable PITR from day one if the tier cost is acceptable — flagging as a real
budget question, not purely a technical one.

**Decision:** Overridden — default daily backups only for now, PITR decision deferred again.
Since this repeats the exact "decide later" pattern that left the current project's backup
posture undocumented, whoever revisits this should set an explicit trigger (e.g. "before first
real client's data lands" or a specific date) rather than leaving it open-ended a second time.

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial RFC, written from the 2026-07-27 birds-eye technical review's infra/ops survey findings and RFC-001's deferred backup/DR decision. |
| 1.1.0 | 2026-07-27 | All 4 decisions recorded and approved: bundle with RFC-001's hosting setup; clean cutover (nothing worth preserving in the current project); explicit `supabase secrets set` for service-role; default daily backups only, PITR deferred again with a note to set an explicit trigger next time. |
| 1.2.0 | 2026-08-09 | Decision 1's hosting cross-reference updated: RFC-001's Decision 1 was superseded by RFC-005, which also confirmed this RFC's plan (clean cutover, bundled timing) executes as-is — RFC-005's own Decision 2. No decision substance changed, only which RFC this migration bundles with. |
