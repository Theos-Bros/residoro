# ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes

**Status:** Approved — Implemented (with one known gap, see below)
**Version:** 1.3.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-08-09

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
   `tenant_id` set) call — **must** use a per-request Supabase client scoped to the caller,
   constructed by forwarding the caller's JWT (`session.access_token`) rather than the
   service-role key. RLS policies (already correct and consistent across every tenant-scoped
   table) become the actual enforcement boundary for these routes, matching ADR-002's original
   intent. **Refreshed 2026-08-09** (the original list here — properties, listings, contacts,
   projects, developers, project_unit_types, property_media, property_documents, dockets, and
   the tenant-facing migration-preview/upload routes — predated most of what's shipped since;
   confirmed live via a full route-file survey): every tenant-user-facing route file under
   `application/backend/src/routes/` now uses `getScopedClient` as its default client, with the
   specific, named exceptions recorded in Decision #4 and the Known Gap section below — not an
   enumerated allowlist anymore, since the route count has grown too fast for one to stay
   current (see RFC-004's documentation-cadence decision on this exact failure mode).
2. **Operator/cross-tenant/trusted-job routes** — `/admin/*` operator routes, the migration
   importer (writes into an arbitrary tenant's tables on the operator's behalf), and the
   pg_cron-triggered Edge Functions (`contract-expiry-check`, `training-reminder-check`,
   `listing-authority-expiry-check`, and — **added 2026-08-09**, shipped 2026-08-08 by
   `tb-notifications-task-due-reminder-001`, missed in the prior revision —
   `task-due-reminder-check`) — continue to use the service-role client (`supabaseAdmin`).
   These are the genuinely cross-tenant/trusted-job cases ADR-002 meant to carve out.
3. The existing hand-written `.eq('tenant_id', ...)` filtering pattern is **not** removed from
   tenant-user-facing routes — it stays as an explicit, readable first layer, with RLS now
   providing the actual guarantee underneath it rather than nothing.
4. **Implementation-time exceptions found within "tenant-user-facing" scope** (recorded here
   post-implementation, per `tb-platform-rls-scoped-client-001`'s DoD — these are not policy
   changes, just cases where a blanket per-route swap would have silently broken a feature or
   simply doesn't apply):
   - `dockets.ts` (`listing-dockets` routes): `listing_dockets` itself is identity-scoped
     (`shared_by`/`shared_with = auth.uid()`) and safe to scope, but three reads are
     genuinely cross-tenant **by design** (the whole point of co-broker sharing,
     `tb-listings-co-broker-share-001`) and stay on `supabaseAdmin`: looking up the recipient's
     profile by handle, looking up sharers' profiles for the recipient's inbox, and the joined
     listing/property data for a docket whose source tenant isn't the recipient's own
     (`profiles_select_same_tenant` / `listings_select_tenant` / `properties_select_tenant`
     would otherwise silently null these out under the scoped client). See the file-level
     comment in `application/backend/src/routes/dockets.ts`.
   - `workspace.ts` (`/me/*` routes): `workspaces` scopes cleanly, but `contract_notifications`
     stays on `supabaseAdmin` — that table has RLS enabled with **zero policies**, by deliberate
     design (`20260722120000_contract_expiry.sql`: "service-role-only, every access goes
     through the backend API"), mirroring `migration_temp_files`' precedent. This isn't a gap
     the scoped client should close; it's an existing intentional service-role-only table.
   - Storage operations (`propertyMedia.ts`, `propertyDocuments.ts`): `.storage.upload()` and
     `.storage.remove()` stay on `supabaseAdmin` — the `property-media`/`property-documents`
     buckets only have a `SELECT` `storage.objects` policy, no `INSERT`/`DELETE` policy, so a
     scoped client could sign existing URLs but not write. Kept storage on one client per file
     for consistency rather than splitting further given the marginal RLS benefit.
     **Update 2026-07-27 (`tb-properties-media-external-links-001`):** this exception no longer
     applies to `propertyMedia.ts` at all — the `property-media` bucket was removed entirely
     (Residoro doesn't host photos/videos; users paste external links instead), so there is no
     Storage call of any kind left in that file. The exception still stands for
     `propertyDocuments.ts`/`property-documents`, untouched by that tracer bullet.
   - `export.ts` and the property-media cover-photo signed-URL helper in `listings.ts`: `export.ts`
     turned out to be a straightforward full migration (all reads are the caller's own tenant,
     no cross-tenant join) — the "may need per-query treatment" hedge in this ADR's original
     Consequences section didn't end up applying there.
   - **Added 2026-08-03 (birds-eye review):** `matching.ts` (`scoreReceivedDockets`) and
     `buyerRequirements.ts` (`/buyer-requirements/:id/options-sent`), both shipped by
     `tb-buyer-leads-matching-001`/`tb-buyer-leads-schema-001` (2026-07-28), after this ADR's
     last revision. Both reuse the exact `dockets.ts` cross-tenant-docket-join pattern above —
     scoring/showing a docket the caller received necessarily reads through to the *sharer's*
     tenant's listing/property data, which a scoped client would silently null out under
     `properties_select_tenant`/`listings_select_tenant`. Same rationale as `dockets.ts`, just
     not recorded here until now.
   - **Added 2026-08-09 (birds-eye audit):** `matchLogs.ts`'s `/buyer-requirements/:id/match-logs`
     route, shipped by `tb-buyer-leads-match-itinerary-001` (2026-08-06) — three
     `supabaseAdmin` reads (`listings`, `properties`, `profiles`, joined for a matched-item's
     display data) with an inline code comment citing the same rationale as `matching.ts`
     directly: a logged match item can reference a docket-shared listing sourced from a
     different tenant. Same pattern, missed when Decision #4 was last updated. A separate call
     in the same file (`supabaseAdmin.auth.admin.getUserById`) is unrelated — the Auth Admin API
     always requires the service-role client regardless of tenant scoping, not a cross-tenant
     RLS case.
   - **Added 2026-08-09 (birds-eye audit):** `members.ts` (`/workspace/members` invite/list/
     remove routes), shipped by `tb-client-lifecycle-member-invite-001` (2026-07-29) — every
     call in this file is on `supabaseAdmin`, for two genuinely distinct reasons, neither a
     scoped-client gap: (1) `auth.admin.inviteUserByEmail`/`listUsers`/`deleteUser` are Auth
     Admin API calls, service-role-only by Supabase's own design, same as the `getUserById` case
     above; (2) the `profiles` table only grants `authenticated` a bare `select` and a
     column-level `update (full_name)` (`20260721120000_platform_foundation.sql`) — updating
     `tenant_id`/`role` to add a member, or deleting a `profiles` row to remove one (no delete
     RLS policy exists on `profiles` at all), are both operations the scoped client is
     structurally incapable of performing. This was never a gap, just never recorded.
   - **Fixed, not exempted, 2026-08-09 (birds-eye audit):** `leadActivityLog.ts`'s
     `/buyer-requirements/:id/activity-log` route had an unexplained `supabaseAdmin` read for
     `profiles.handle` lookups — unlike the cases above, this one had **no cross-tenant
     rationale**: the profile rows being read belong to same-tenant colleagues (`logged_by` on
     an already tenant-filtered `buyer_requirement_activity_log` row), which
     `profiles_select_same_tenant` already permits directly. Confirmed this was an unexamined
     bypass, not a designed exception, and switched it to the scoped client already in scope in
     the same function — no RLS or schema change needed.

---

## Known Gap (not an exception — flagged, not yet fixed)

**`migrations.ts` (CSV import routes: upload/analyze/preview/confirm/rollback) does not comply
with Decision #1.** Decision #1 explicitly names "the tenant-facing migration-preview/upload
routes" as required to use the scoped client. In current code, every one of `migrations.ts`'s 29
data calls uses `supabaseAdmin`, for both its operator-driven branch (`requireMigrationAccess`
with `role = 'operator'`, a query-param `tenant_id` — a legitimate Decision #2 case) **and** its
self-service branch (`requireAuth`, an ordinary brokerage caller — the branch Decision #1
actually covers).

Unlike the exceptions above, this isn't a case where a blanket swap would break a feature — it's
simply not yet done. Verified manually (2026-08-03 birds-eye review, full file read) that every
query in `migrations.ts` and its `findPropertyConflicts` helper filters by `tenant_id` (either
directly, or via an `id`/`batch_id` already tenant-verified earlier in the same request), so
there is no known cross-tenant leak today — but that safety currently rests entirely on
hand-written filtering with no RLS backstop, exactly the pre-ADR-003 posture this ADR exists to
move away from for tenant-user-facing routes. Migrating the self-service branch to the scoped
client (while the operator branch, which reads an arbitrary tenant's data by design, stays on
`supabaseAdmin`) is open follow-up work, not scheduled as of this writing.

---

## Consequences

- (+) RLS is now the real enforcement boundary for tenant-user-facing routes, not dormant
  policy — a future route that forgets its manual filter can no longer leak cross-tenant data,
  because the database blocks it regardless of application code. Verified live
  (2026-07-27, `verify-rls-scoped-client.ts`): a cross-tenant `properties` read through the
  scoped client with no app-level `tenant_id` filter at all returns an empty result, not the
  row.
- (+) No RLS policy or schema change required — the existing policies are already correct;
  this was a backend client-wiring change only.
- (+) The co-broker docket-sharing feature (`tb-listings-co-broker-share-001`), which is
  genuinely cross-tenant by design, still works correctly after the per-query split described
  in Decision #4 — verified live end-to-end (`verify-rls-docket-cross-tenant.ts`): a real
  cross-tenant share still returns real, live-projected field values, not nulls.
- (–) Each RLS-checked query does a small additional lookup via the `current_tenant_id()`/
  `current_role()` helper functions (already noted as acceptable at current scale in ADR-002).
- (–) Not every tenant-user-facing route got a uniform per-route swap — `dockets.ts` and
  `workspace.ts` needed per-query treatment (Decision #4). This adds a small amount of
  inconsistency across route files in exchange for correctness; flagged inline in each file
  rather than silently applying the blanket rule where it would have broken a feature.

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
| 1.1.1 | 2026-07-27 | `tb-properties-media-external-links-001` removed the `property-media` Storage bucket entirely (photos/videos are now pasted external links) — noted that the storage-write exception in Decision #4 no longer applies to `propertyMedia.ts`, only to `propertyDocuments.ts`. |
| 1.2.0 | 2026-08-03 | Birds-eye review: added `matching.ts`/`buyerRequirements.ts` to Decision #4's exception list (same `dockets.ts` cross-tenant-join pattern, shipped 2026-07-28 but never recorded). Added a new "Known Gap" section documenting `migrations.ts`'s non-compliance with Decision #1 — verified manually safe (every query tenant-filtered) but not yet migrated to the scoped client; this is open follow-up work, not a designed exception. |
| 1.3.0 | 2026-08-09 | Birds-eye audit: Decision #1's route list replaced with a survey-confirmed statement (enumerated allowlists don't stay current at this shipping velocity — see RFC-004). Decision #2 gained a 4th trusted Edge Function (`task-due-reminder-check`, shipped 2026-08-08, missed in the prior revision). Decision #4 gained two real, previously-unrecorded exceptions (`matchLogs.ts`, `members.ts`). A third case, `leadActivityLog.ts`, turned out to be an unexamined bypass rather than a real exception — fixed same-day, not added to the exception list. |
| 1.1.0 | 2026-07-27 | Implemented via `tb-platform-rls-scoped-client-001`. Added Decision #4 recording implementation-time exceptions found within "tenant-user-facing" scope (dockets.ts's genuinely cross-tenant reads, workspace.ts's contract_notifications no-policy table, storage write operations) and updated Consequences with live verification results. |
