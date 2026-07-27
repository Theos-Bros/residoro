# TS-001 — Backend Architecture & Request Handling

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Document how the Fastify backend is actually structured and the implementation patterns applied
consistently across it — auth, tenant scoping, error handling, validation. Written from a
2026-07-27 birds-eye technical review; the first TS document written for this codebase.

---

## Scope

Covers `application/backend/src/` structure and cross-cutting patterns. Does not cover any
route's specific HTTP contract (see `docs/api/`) or the database schema (see `docs/dd/`).

---

## Stack & Structure

Fastify 5, TypeScript, no versioning prefix on routes (`/properties`, not `/v1/properties`).
`@fastify/cors` (currently `origin: true` — see Known Gaps) and `@fastify/multipart` registered
globally. Routes are plugin functions under `src/routes/*.ts`, one file roughly per resource
(though `GET /properties/:id` lives in `propertyMedia.ts` rather than `listings.ts`, where the
rest of Property CRUD lives — a file-organization inconsistency, not a functional one). Auth
guards live in `src/lib/auth.ts` (see API-001). One-off account-seeding scripts live in
`src/scripts/` — six `create-*-verify-account.ts` scripts, one per tracer bullet that needed
live verification, plus `create-operator.ts`. No automated test suite exists (zero `*.test.*`/
`*.spec.*` files) — every tracer bullet has been manually verified via these seed scripts
instead.

---

## Tenant Scoping Pattern

Every handler uses the service-role Supabase client (`supabaseAdmin`) and explicitly filters
`.eq('tenant_id', request.user.tenantId)` — a deliberate, repeated pattern ("never trust tenant
scoping from the body," per comments across `listings.ts`/`projects.ts`/`propertyMedia.ts`), not
an accident. RLS policies exist and are consistent across every tenant-scoped table (see any
DD-*), but do not currently execute for any real request, since the service-role client bypasses
them entirely — see ADR-002's "Superseded By (partial)" note and ADR-003 for the corrected
target architecture (scoped client for tenant-user-facing routes, admin client reserved for
operator/cron/migration-importer), not yet implemented.

---

## Validation

No schema-validation library (no zod/ajv/joi) anywhere. Every route hand-writes field
presence/type checks inline — verbose but consistent. Enum/status lists
(`PROPERTY_TYPES`/`PROPERTY_STATUSES`/`LISTING_STATUS_TRANSITIONS`, etc.) are hand-duplicated
across `listings.ts` and `projects.ts` with an explicit code comment acknowledging this ("no
shared-types package in this codebase, so kept in sync by hand").

---

## Error Handling

No centralized error handler (no Fastify `setErrorHandler`) — every route repeats its own
try/catch around Supabase's `{ data, error }` destructuring and manually calls
`reply.status(...)`. No request logging/metrics middleware beyond Fastify's built-in logger
(`logger: true`) — logs go to console only, nothing shipped anywhere durable (see RFC-001's
observability decision).

---

## Known Gaps (as of 2026-07-27)

- **No rate limiting** on any route, including `/migrations/upload` (10 MB cap, multipart) and
  email-triggering admin routes.
- **CORS wide open** (`origin: true`) — no environment-based origin restriction. Tracked as a
  no-RFC-needed fix in RFC-001's appendix.
- **Synchronous, unqueued heavy operations**: `POST /migrations/:fileId/import` writes up to
  10,000 rows in one HTTP request/response cycle — no job queue exists anywhere in this
  codebase. Accepted tracer-bullet tradeoff, flagged as a scaling risk before this document
  locks in the target architecture further.
- **No shared-types package** — enum lists and state machines are hand-duplicated between the
  backend and the frontend (see TS-002), with no compile-time or codegen safety net.

---

## Related Documents

- ADR-002 — Workspace Isolation & Row-Level Security
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- RFC-001 — Pre-Scaling Infrastructure Readiness (CORS, observability, CI)
- `docs/api/` — the HTTP contract this architecture serves
- TS-002 — Frontend Architecture
- TS-003 — Automated Notification Architecture

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written from a birds-eye technical review. |
