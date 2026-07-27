# RFC-002 — RLS Enforcement vs. Trusted-Backend-Only

**Status:** Approved
**Version:** 1.1.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Decide whether Row-Level Security (RLS) should become Residoro's actual tenant-isolation
enforcement boundary, as ADR-002 originally intended — or whether "trusted backend + manual
tenant scoping" should be formally adopted as the real architecture instead, with ADR-002
corrected to describe defense-in-depth rather than enforcement.

---

## Scope

Applies to every route that reads or writes tenant-scoped data (`properties`, `listings`,
`contacts`, `projects`, `developers`, `project_unit_types`, `property_media`,
`property_documents`, and their `migration_temp_files`/`import_batches`/`imported_*` siblings).
Does not cover fine-grained per-field/per-action permissions beyond `admin`/`member`/`operator`
— that's a separate future Permission Engine milestone (already scoped out by ADR-002 itself).

---

## Related Documents

- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security (the decision this RFC re-examines)
- RFC-001 — Pre-Scaling Infrastructure Readiness

---

## Context

ADR-002 (2026-07-21) decided RLS would be the enforcement boundary for tenant isolation, and
was explicit about why: "isolation holds even if application code forgets a `WHERE tenant_id =
...` clause — the database enforces it regardless of which code path issued the query," and
"works uniformly for direct SQL, the Node.js backend, and the frontend's anon-key client — one
enforcement point, not three." It named the service-role bypass as a narrow, deliberate
exception: "a deliberate, accepted escape hatch for **trusted backend jobs (e.g. the future
migration importer)**" — singular, exceptional.

A birds-eye survey (2026-07-27) found that in the actual codebase, **100% of backend routes**
— not just the migration importer, every route: properties, listings, contacts, projects,
developers, property_media, property_documents, dockets, admin, everything — use the
service-role client (`supabaseAdmin`). This is confirmed explicitly in the code's own comments
(`listings.ts`: "the `properties_delete_admin` policy has never actually been enforced for any
route"). Tenant isolation is real and consistently applied, but it's enforced entirely by
hand-written `.eq('tenant_id', request.user.tenantId)` filters repeated in every route — a
deliberate, explicit pattern ("never trust tenant scoping from the body," repeated across
`listings.ts`/`projects.ts`/`propertyMedia.ts`) — not by RLS. RLS policies exist, are applied
consistently to every tenant-scoped table (the standard 4-policy set), and would work correctly
if a scoped client ever queried through them — but nothing currently does. As implemented, RLS
is dormant, not defense-in-depth: there's no second code path for it to catch a mistake on.

This matters more once real client data is on the platform: with zero automated tests in the
repo today, the manual `.eq('tenant_id', ...)` pattern is the *only* thing standing between one
brokerage and another's data on every single new route — and that guarantee currently depends
entirely on every future contributor (including AI-assisted tracer-bullet work) remembering to
repeat it correctly, forever, with nothing at the database layer to catch a miss.

---

## Decision: Enforcement Model

| Option | Pros | Cons |
|---|---|---|
| **Switch to a per-request scoped Supabase client for tenant-user-facing routes** *(Recommended)* — forward the caller's JWT into a request-scoped client instead of always using `supabaseAdmin`, so RLS policies (which already exist and are already consistent across every tenant-scoped table) actually execute on every query. Keep `supabaseAdmin` only for genuinely cross-tenant/admin operations: `/admin/*` operator routes, the migration importer (writes into an arbitrary tenant on the operator's behalf), and the three cron Edge Functions. | Makes ADR-002's original guarantee true rather than aspirational — a future route that forgets a manual filter still can't leak cross-tenant data, because the database blocks it regardless. The DB-side work is already done (RLS policies are already correct and consistent); this is a backend client-wiring change, not a schema change. Matches ADR-002's original design intent exactly — no new ADR needed, just closing the gap between decision and implementation. | Real engineering effort: every tenant-user-facing route (~20+) needs to switch from `supabaseAdmin` to a scoped client, and each needs re-verification that it still behaves correctly under RLS (the `current_tenant_id()`/`current_role()` helper-function lookup adds a small per-query cost, already called out as "acceptable at this scale" in ADR-002). Requires clearly drawing the line between "user-facing, must be scoped" vs. "operator/cron, stays admin" for every route. |
| **Formalize service-role-everywhere as the real architecture; downgrade ADR-002 to describe RLS as unused defense-in-depth** | Zero engineering effort — matches exactly what's already built and shipped across 40+ tracer bullets; ships immediately. | RLS provides no actual protection today under this option — a future route that misses a manual filter has nothing to catch it. Doesn't actually reduce risk, just documents the risk honestly instead of leaving it silently misdescribed. Needs a compensating safeguard (see Decision 2 below) to be responsible at all. |
| **Phased: scoped client for the highest-risk routes first (properties, listings, contacts — the core brokerage business data), admin client elsewhere for now** | Middle ground — closes the biggest exposure (the data brokerages would most object to leaking) without a single big-bang refactor across every route. | Leaves a mixed enforcement model for a period (some routes RLS-protected, some not) — has to be tracked explicitly so "which routes are actually protected" doesn't become unclear; still requires deciding and re-verifying which routes move first. |

**Recommendation:** Switch to a per-request scoped client for tenant-user-facing routes. The
database-side work (RLS policies) is already done and already consistent — this closes a real
gap between what ADR-002 says the architecture is and what it actually is, before real client
data is on the platform, while there are still only ~20 routes to touch rather than more.

**Decision:** Switch to a per-request scoped Supabase client (forwarding the caller's JWT) for
all tenant-user-facing routes, as recommended. `supabaseAdmin` (service-role) remains reserved
for `/admin/*` operator routes, the migration importer, and the three cron Edge Functions — the
genuinely cross-tenant/trusted-job cases ADR-002 originally meant to carve out.

**Follow-up required:** This decision needs (a) a new or superseding ADR recording the corrected
architecture (ADR-002 currently states the escape hatch is narrow — "the future migration
importer" — when in the current codebase it's universal; that statement needs to be fixed to
match this decision, not left contradicting it), and (b) an actual implementation pass across
~20 routes, which should ship as its own tracer bullet(s) in `theos-registry` rather than as a
side effect of this documentation review — this RFC decides the target architecture, it doesn't
implement it.

---

## Decision 2: If Service-Role-Everywhere Is Chosen Instead — Compensating Safeguard

Only applies if Decision 1 above is "formalize as-is." Not needed if the scoped-client option is
chosen, since RLS itself becomes the safeguard.

| Option | Pros | Cons |
|---|---|---|
| **Integration test suite asserting tenant isolation on every list/get endpoint** | Directly tests the actual risk (cross-tenant data leakage); catches regressions on existing routes | Only catches what's explicitly tested — a new route added without a corresponding test reintroduces the exact same risk; the repo has zero tests today, so this is also a new investment, not a small one |
| **Code-review checklist / STD convention requiring an explicit tenant-scoping line in every new route, reviewed every time** | Cheapest option; formalizes the pattern that's already being followed in practice | Purely procedural — no automated enforcement; relies on discipline the same way the current unwritten pattern already does, just written down |
| **Both** | Strongest safeguard available without doing the RLS-enforcement refactor | Doesn't reach DB-level guarantees either way — this whole path is inherently weaker than Decision 1's scoped-client option |

**Recommendation:** N/A — Decision 1 chose the scoped-client option, so this decision does not
apply. RLS itself is the safeguard.

**Decision:** N/A.

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial RFC, written from the 2026-07-27 birds-eye technical review's backend/data-model survey findings. |
| 1.1.0 | 2026-07-27 | Decision recorded: switch to a per-request scoped client for tenant-user-facing routes; admin client reserved for operator/cron/migration-importer routes. Decision 2 (compensating safeguard) does not apply. Follow-up: corrected ADR + implementation tracer bullet(s), both still outstanding. |
