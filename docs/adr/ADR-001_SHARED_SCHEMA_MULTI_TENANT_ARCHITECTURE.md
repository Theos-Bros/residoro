# ADR-001 — Shared-Schema Multi-Tenant Architecture

**Status:** Approved
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-07-21

---

## Purpose

Record the decision to use one Postgres database and one schema, with tenant-scoped rows, as
Residoro's multi-tenancy model — not a schema-per-tenant or database-per-tenant approach.

---

## Scope

Applies to every table that stores brokerage-owned operational data across the whole
platform, present and future. Does not cover how isolation is enforced at the database layer
(see ADR-002) or fine-grained permissions within a tenant (Permission Engine — separate,
later milestone).

---

## Context

CTX-002 (Product Architecture) and CTX-003 (Engineering Context) already describe Residoro as
serving many brokerages from one platform, with "Workspace Isolation" as a cross-cutting
principle every business domain must support. Residoro's stated goal is thousands of
brokerages on one platform, each expecting their operational data to be invisible to every
other brokerage. Three shapes were available: one database per tenant, one schema per tenant
(shared database), or one shared schema with tenant-scoped rows.

---

## Decision

Shared schema. A single Postgres database, a single `public` schema. Every tenant-scoped table
carries a `tenant_id UUID NOT NULL REFERENCES workspaces(id)` column. Isolation between
tenants is enforced at the database layer via Row-Level Security (see ADR-002), not by
schema/database separation and not by application code alone.

---

## Consequences

- (+) One migration applies to every tenant at once — no per-tenant schema drift to manage as
  brokerage count grows into the thousands.
- (+) Cross-tenant analytics/reporting (a stated product goal in CTX-002) is a single query
  away, rather than a fan-out across N schemas or databases.
- (+) Onboarding a new brokerage is a row insert (`workspaces`), not a provisioning step.
- (–) A missed `tenant_id` filter or an RLS gap leaks data across tenants. This is the central
  risk of this architecture — RLS must be enabled from the very first migration that creates a
  tenant-scoped table, never bolted on after data already exists (see ADR-002).
- (–) Noisy-neighbor risk at very large scale (one brokerage's data volume or query load could
  affect others sharing the same tables). Accepted for now; revisit only if it becomes a real
  bottleneck — not a concern at foundation stage.

---

## Alternatives Considered

- **Database-per-tenant:** rejected. Operational overhead (provisioning, migrations, backups,
  connection pooling) scales linearly with brokerage count, directly against the "thousands of
  brokerages on one platform" goal.
- **Schema-per-tenant (shared database):** rejected for the same reason as above, one level
  less severe — still means every migration must be replayed N times, and cross-tenant
  reporting requires fan-out queries instead of a single `WHERE tenant_id = ...`.

---

## Related Documents

- CTX-002 — Product Architecture
- CTX-003 — Engineering Context
- ADR-002 — Workspace Isolation & Row-Level Security
- DS-001 — Platform Foundation: Identity & Workspace
- DD-001 — Workspaces & Profiles

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial decision record, written alongside the first migration that implements it. |
