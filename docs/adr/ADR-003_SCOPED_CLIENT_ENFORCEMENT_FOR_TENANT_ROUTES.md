# ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes

**Status:** Approved
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Correct and make explicit which Supabase client type each backend route must use, superseding
the "deliberate, accepted escape hatch... for trusted backend jobs" framing in ADR-002's
Consequences section. ADR-001 and ADR-002's core decisions (shared schema, RLS keyed off
`tenant_id`/`current_tenant_id()`) are unchanged and still in force — this ADR only corrects and
tightens how the service-role client is scoped.

---

## Scope

Applies to every backend route in `application/backend/src/routes/`. Does not change the RLS
policies themselves (already correct and consistent per ADR-002) or the shared-schema model
(ADR-001) — only which Supabase client each route is required to use.

---

## Context

ADR-002 described the service-role bypass as narrow: "a deliberate, accepted escape hatch for
trusted backend jobs (e.g. the future migration importer)." A birds-eye technical review
(2026-07-27) found that in practice, every route in the backend — not just the migration
importer — uses the service-role client (`supabaseAdmin`), meaning RLS has not been the actual
enforcement boundary for any real request since the first route was written. Tenant isolation
has instead been enforced entirely by hand-written `.eq('tenant_id', ...)` filters repeated in
every route (a real, consistently-applied pattern, but one with no database-level backstop if a
future route omits it).

RFC-002 (Approved, 2026-07-27) decided this should be corrected rather than formalized as-is.

---

## Decision

1. **Tenant-user-facing routes** — anything a brokerage's own users (`admin`/`member` role,
   `tenant_id` set) call: properties, listings, contacts, projects, developers,
   project_unit_types, property_media, property_documents, dockets, and the tenant-facing
   migration-preview/upload routes — **must** use a per-request Supabase client scoped to the
   caller, constructed by forwarding the caller's JWT (`session.access_token`) rather than the
   service-role key. RLS policies (already correct and consistent across every tenant-scoped
   table) become the actual enforcement boundary for these routes, matching ADR-002's original
   intent.
2. **Operator/cross-tenant/trusted-job routes** — `/admin/*` operator routes, the migration
   importer (writes into an arbitrary tenant's tables on the operator's behalf), and the three
   pg_cron-triggered Edge Functions (`contract-expiry-check`, `training-reminder-check`,
   `listing-authority-expiry-check`) — continue to use the service-role client
   (`supabaseAdmin`). These are the genuinely cross-tenant/trusted-job cases ADR-002 meant to
   carve out.
3. The existing hand-written `.eq('tenant_id', ...)` filtering pattern is **not** removed from
   tenant-user-facing routes — it stays as an explicit, readable first layer, with RLS now
   providing the actual guarantee underneath it rather than nothing.

---

## Consequences

- (+) RLS becomes the real enforcement boundary for tenant-user-facing routes, not dormant
  policy — a future route that forgets its manual filter can no longer leak cross-tenant data,
  because the database blocks it regardless of application code.
- (+) No RLS policy or schema change required — the existing policies are already correct;
  this is a backend client-wiring change only.
- (–) Every tenant-user-facing route needs to switch from `supabaseAdmin` to a scoped client and
  be re-verified under RLS — real implementation effort across roughly 20 routes, not yet done.
  This ADR records the target architecture; implementation is tracked separately as a
  `theos-registry` tracer bullet, not part of this documentation change.
- (–) Each RLS-checked query does a small additional lookup via the `current_tenant_id()`/
  `current_role()` helper functions (already noted as acceptable at current scale in ADR-002).

---

## Related Documents

- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security (this ADR supersedes its Consequences
  section's framing of service-role scope only; ADR-002's core decision — RLS keyed off
  `tenant_id`/`current_tenant_id()` — is unchanged)
- RFC-002 — RLS Enforcement vs. Trusted-Backend-Only (the discussion and decision this ADR
  records)

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial decision record, written from RFC-002's approved decision. |
