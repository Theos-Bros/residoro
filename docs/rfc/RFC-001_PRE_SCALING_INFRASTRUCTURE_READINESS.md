# RFC-001 — Pre-Scaling Infrastructure Readiness

**Status:** Approved (Decision 1 superseded by RFC-005, 2026-08-09)
**Version:** 1.2.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-08-09

---

## Purpose

Decide what infrastructure has to exist before Residoro onboards real, paying brokerage clients
— as opposed to the current prototype-with-manual-QA-accounts posture. This RFC exists because a
birds-eye technical review (2026-07-27) found several infrastructure gaps that are genuine
judgment calls (more than one defensible path), not corrections with an obvious right answer.

---

## Scope

Covers: CI/CD gating, staging/deploy environment strategy, error monitoring/observability, and
backup/DR policy. Each is a real decision requiring a hosting-platform choice or a
timeline/resourcing tradeoff only Residoro's owner can make.

Does **not** cover: CORS restriction, `.env.example`, or a baseline lint/typecheck/build CI
job — these have no defensible alternative (there's no reason CORS should stay wide open, or
that an env template shouldn't exist) and are tracked as direct fixes in
[Appendix: No-RFC-Needed Fixes](#appendix-no-rfc-needed-fixes) instead of decisions here. Also
does not cover the RLS/service-role enforcement question (see `docs/adr/ADR-002`'s stated intent
vs. actual usage) — that's a separate, architecture-level RFC.

---

## Related Documents

- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- `theos-registry` — `cap-client-lifecycle-001` (invite-only/operator-run client model this
  infrastructure needs to support)

---

## Context

A birds-eye survey of `residoro` (2026-07-27) found:

- No `.github/workflows` — no CI of any kind. Every change (migrations, Edge Functions, backend,
  frontend) ships with zero automated gating.
- No deployment config anywhere in the repo (no Dockerfile, no Vercel/Netlify/Fly/Render config)
  — deploys are manual and undocumented. Only one git branch (`main`) exists; there is no
  staging environment.
- No error monitoring — backend logs to console only (Fastify's built-in logger, `logger: true`,
  nothing shipped anywhere durable); Edge Functions use `console.error` only.
- No documented backup/DR policy. The only mention of "backups" in the repo is a one-line
  rejected-alternative note in ADR-001 about database-per-tenant tradeoffs — not an actual
  policy for the shared-schema design that was chosen.
- `README.md`'s repository-structure diagram lists `.github/`, `infrastructure/`, `operations/`,
  `tools/`, `archive/` — none of these exist on disk. Aspirational, and misleading to anyone
  using the README as a map.

None of this is urgent for a single-operator-run prototype with manually seeded QA accounts. It
becomes urgent once real brokerages' data and business operations depend on the platform.

---

## Decision 1: Hosting Platform

Nothing is currently chosen. This blocks both the staging-environment and CI-deploy-step
decisions below, so it has to be resolved first.

| Option | Pros | Cons |
|---|---|---|
| **Vercel (frontend) + Render/Fly.io (backend)** *(Recommended)* | Minimal ops overhead; Vercel is a natural fit for a Vite/React SPA with zero config; Render/Fly both support a long-running Fastify process with simple env-var-based config matching what already exists (`PORT`, `host: '0.0.0.0'` is already Fly/Render-friendly) | Two platforms to manage instead of one; some cross-origin config still needed between them |
| **Single VPS (e.g. Hetzner/DigitalOcean) running both via Docker Compose** | One bill, one place to reason about; full control | Residoro has zero containerization today (no Dockerfile) — this is strictly more upfront work than the split-platform option; you'd own OS patching, TLS renewal, process supervision yourself |
| **Fully serverless (Vercel Functions / Cloudflare Workers for backend too)** | Scales to zero, cheapest at low volume | Fastify's current design (long-lived process, `logger: true`, no per-request cold-start handling) would need real rework; not a drop-in fit for the existing backend code |

**Recommendation:** Vercel + Render/Fly split. Lowest migration cost from current code, matches
what's already there (`PORT` env var, `0.0.0.0` bind).

**Decision:** Vercel (frontend) + Render/Fly.io (backend), as recommended. The single-VPS/Docker
Compose option is explicitly deferred, not rejected — revisit only if a concrete signal of
demand for it shows up (e.g. a cost or control constraint that the split-platform approach can't
meet). Do not raise it again absent that signal.

**Superseded 2026-08-09 by RFC-005** (Hosting & Deployment Plan Reconciliation): this decision
was never priced, and RFC-005's live-sourced research found Vercel's Hobby (free) tier explicitly
prohibits commercial use, making the real cost ~$27–45/mo, not the ~$0 this decision implicitly
assumed. RFC-005 replaces this Decision with Cloudflare Pages (frontend) + Render (backend). This
record is left as-is per this repo's convention for reversed decisions — see RFC-005 for the
current, operative hosting decision.

---

## Decision 2: Staging Environment Strategy

Depends on Decision 1.

| Option | Pros | Cons |
|---|---|---|
| **Full staging environment now** — second Supabase project or branch, second hosting deploy, `staging` git branch, promote to `main` via PR | Real pre-prod verification before every client-facing change; matches "pre-scaling" framing directly | Meaningful setup cost now, before the hosting platform or even client volume is proven; doubles Supabase project management overhead right as a prototype→production Supabase migration is *already* separately planned |
| **Defer staging; add a documented manual deploy runbook instead** *(Recommended)* | Near-zero cost now; unblocks CI/CD Decision 3 without a second environment to maintain | No pre-prod safety net until staging is eventually built; relies on discipline instead of infrastructure |
| **Use Supabase branching (preview databases) without a separate hosting staging deploy** | Cheaper middle ground — DB-level preview without a full second deploy target | Only covers the database side; frontend/backend still deploy straight to prod |

**Recommendation:** Defer full staging until closer to the first real client, but write the
manual deploy runbook now (cheap, immediate value, and it's the thing the README currently
implies exists via its `operations/` folder reference but doesn't). Revisit once the planned
Supabase project migration (already tracked separately) has a date — the new project is a
natural point to also stand up staging, rather than building staging twice.

**Decision:** Defer full staging; write the manual deploy runbook now, as recommended. Revisit
when the Supabase project migration gets a date.

---

## Decision 3: Observability / Error Monitoring

| Option | Pros | Cons |
|---|---|---|
| **Sentry (free tier)** *(Recommended)* | Purpose-built for exactly this; ~30 min to wire into both the Fastify backend and the React frontend; catches unhandled exceptions and API errors without changing existing logging code; free tier is generous enough for current volume | Third-party dependency; free tier has event-volume limits that would need revisiting at real scale |
| **Structured logging only (pino, already Fastify's underlying logger) shipped to a log drain** | No new vendor; builds on what's already there | Doesn't give error grouping/alerting the way Sentry does; still need to pick and wire a log destination once hosting is chosen |
| **Do nothing until after Decision 1 (hosting)** | Avoids picking a tool before knowing where logs would even go | Leaves the "console-only" gap open through the exact window (real client onboarding) this RFC is meant to close before |

**Recommendation:** Sentry free tier, independent of the hosting decision — it works the same
regardless of where the app is deployed, so there's no reason to sequence it after Decision 1.

**Decision:** Overridden — wait until hosting (Decision 1) is actually set up before wiring
Sentry or any other observability tool. Revisit once Vercel + Render/Fly.io deploys exist.

---

## Decision 4: Backup / DR Policy

| Option | Pros | Cons |
|---|---|---|
| **Verify and document the current prototype Supabase project's existing backup/PITR settings now** | Closes the "no documented policy" gap immediately, on the project actually in use today | Time spent documenting a project that's already planned to be replaced |
| **Defer backup/DR policy entirely to the planned Supabase project migration** *(Recommended)* | The new project should have backup/PITR decided from day one anyway, as part of that migration's setup — avoids documenting the prototype project's posture twice | Leaves the current prototype project's backup posture undocumented (and possibly under-configured) in the meantime; if real client data ever lands in the *current* project before the migration happens, this gap matters immediately |

**Recommendation:** Conditional — if the Supabase migration is expected to happen *before* any
real client's data touches the platform, defer to the migration. If real client onboarding could
plausibly happen on the *current* prototype project first, verify/document its backup settings
now instead. This is really a question about migration timing, which isn't decided yet — flagging
as the actual open question underneath this one.

**Decision:** Defer to the planned Supabase project migration, as recommended.

---

## Appendix: No-RFC-Needed Fixes

Tracked here for visibility, not as decisions — these will be executed directly once confirmed,
no tradeoff to weigh:

1. **Restrict CORS** — `application/backend/src/index.ts` currently registers `cors` with
   `origin: true` (reflects any request origin). Replace with an explicit allow-list read from
   an env var (prod domain + staging domain, if any + `localhost` for dev).
2. **Create `.env.example`** — none exists for any of `supabase/`, `application/backend/`,
   `application/frontend/`. Var names are already known from source (`VITE_BACKEND_URL`,
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `PORT`, `FRONTEND_URL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`).
3. **Baseline CI job** — `.github/workflows/ci.yml` running `tsc` (typecheck) and `vite build` /
   `tsc -p tsconfig.json` (build) for both `application/frontend` and `application/backend` on
   every PR to `main`. No test suite exists yet to run — that's a separate initiative, not a
   blocker for adding this baseline gate now.
4. **Fix README's repository-structure diagram** — remove or actually create
   `.github/`, `infrastructure/`, `operations/`, `tools/`, `archive/`, whichever ends up true
   once the above land.

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial RFC, written from the 2026-07-27 birds-eye technical review's infra/ops survey findings. |
| 1.1.0 | 2026-07-27 | All 4 decisions recorded and approved: Vercel+Render/Fly.io hosting (VPS deferred, not rejected); defer staging, write a manual deploy runbook now; defer observability until hosting exists; defer backup/DR to the planned Supabase migration. |
| 1.2.0 | 2026-08-09 | Decision 1 superseded by RFC-005 (a birds-eye audit found it conflicted, unreconciled, with `cap-deployment-001`) — pointer added below the original decision text, which is left unrewritten per this repo's convention. Decisions 2–4 unaffected. |
