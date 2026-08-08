# CTX-002 — Product Architecture

**Status:** Approved  
**Version:** 2.1.1  
**Owner:** Residoro Engineering  
**Created:** 2026-07-20  
**Last Updated:** 2026-08-08

---

# Purpose

This document defines the overall architecture of Residoro as a product.

Rather than describing implementation details, it explains the business domains, operational boundaries, and relationships that collectively form the Brokerage Operating System.

This document answers the question:

> **What are we building?**

---

# Scope

This document defines:

- Product vision
- Business domains
- Platform boundaries
- Core business entities
- Product principles
- High-level system architecture

Implementation details are intentionally documented elsewhere.

---

# Related Documents

- CTX-000 — Context Index
- CTX-001 — Project Context
- CTX-003 — Engineering Context
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation
- `theos-registry` (sibling repo) — `registry/capabilities/` for each Built domain's full, current
  design; this document gives the product-level overview, the Registry gives per-capability
  depth and tracer-bullet-level shipped status
- `docs/ds/`, `docs/dd/` — the data model behind every Built domain listed above

---

# Product Definition

Residoro is a **Brokerage Operating System (Brokerage OS)** built specifically for Philippine real estate brokerages.

The platform manages the complete operational lifecycle of a brokerage rather than focusing on a single function such as customer relationship management.

Residoro is designed to become the central operating platform used by every role within a brokerage.

---

# Product Goals

Residoro aims to provide:

- A single source of truth for brokerage data.
- Standardized operational workflows.
- AI-assisted migration from existing systems.
- Secure multi-tenant architecture.
- Configurable business processes.
- Actionable operational analytics.

---

# Product Boundaries

Residoro is responsible for managing brokerage operations.

Residoro is **not** intended to become:

- A public listing marketplace
- A property portal
- A lead generation platform
- A consumer-facing application

Its primary users are brokerage organizations and their staff.

---

# Business Domains

Residoro is organized into business domains rather than application screens.

**Implementation status, as of a 2026-07-27 birds-eye review** — each domain below is marked
**Built** (real, shipped code — see the Theos Registry `theos-registry/registry/capabilities/`
for exact scope) or **Future** (named here as intended direction, no code exists). A
Registry-vs-code audit on the same date found the Built domains genuinely well-aligned with what
their Registry capability docs claim — this status list is not aspirational rounding-up.

## Identity — **Built**

Manages: Workspaces, Users/Profiles, Roles (`admin`/`member`/`operator`).

Not yet built: Organizations as a concept distinct from Workspace, fine-grained Permissions
(the Permission Engine remains a scoped-out future milestone per `mil-platform-foundation-001`).
See DS-001/DD-001.

---

## Client Lifecycle — **Built** (not in the original domain list; added 2026-07-27)

Manages: how a brokerage actually becomes a Residoro client — invite-only qualification (done
outside Residoro), manual operator-driven enrollment (no self-serve signup, no online payment),
contract-based access enforcement (warnings → read-only grace → hard block), onboarding
training tracking, and self-service data export at any point, including on the way out.

**This domain was missing from the original PRD entirely, despite being one of the most
fully-built parts of the platform** (9 shipped tracer bullets — `cap-client-lifecycle-001`) and
core to Residoro's actual go-to-market model: Residoro is deliberately high-touch and curated,
not self-serve SaaS — a brokerage cannot sign up on its own, cannot pay online, and is vetted
human-to-human before an operator creates their Workspace. This is a considered business-model
decision, not a missing feature. See DS-006, `cap-client-lifecycle-001` for full rationale.

---

## CRM — **Partially Built**

Built (as of 2026-07-28, `cap-crm-001`): Contacts (generic entity — DS-005), Company as a
distinct concept (`contacts.is_company`, not a separate table), Buyer as a first-class
relationship on listings (`listings.buyer_contact_id`, required on transition to `status =
'sold'`), a unified Contacts page (list/detail CRUD). The standalone `developers` placeholder
table (DS-007) was consolidated into Contacts, not built out further — Developer is now a
Contact with `is_company = true`.

Not yet built: lead pipelines (see Buyer Operations below — since built separately, not as part
of this domain), activity history, Seller as a distinct relationship (still implicit via
`properties.owner_id`, which needed no equivalent change since it already served that role).

---

## Property Management — **Built**

Manages: Properties, Projects/Developer inventory, Unit Types, bulk unit generation, Media
(photos), Documents (title/tax), Verification status. See DD-002, DD-007, DD-008.

Not yet built: Amenities as a structured entity.

---

## Listing Management — **Built**

Manages: Listings (sale/lease — renamed from sale/rent 2026-08-08, `tb-listings-rent-to-lease-001`
— full lifecycle state machine, auto-expiry), Authority to
Sell/Lease (exclusivity, term dates, per-workspace hard-block policy), cross-brokerage docket
sharing. See DD-006, DS-004.

Not yet built: a distinct Pricing-strategy concept beyond the listing's own price field,
external publication/marketplace syndication (explicitly out of scope — see `cap-listings-001`'s
semantic_scope, reserved for a future Distribution capability).

---

## Buyer Operations — **Partially Built**

Built (`cap-buyer-leads-001`, shipped 2026-07-28 through 2026-07-30): a two-table lead pipeline
— Inquiries (lightweight pre-qualification pen) promoted into Leads on Qualify — with pipeline
stages, scored requirement-matching against the brokerage's own active listings and cross-tenant
docket-shared listings, a "Buyer Wanted" broadcast fallback when no match exists, stage-change
task auto-generation, and a Revisit page tracking leased deals by lease-end date for renewal
outreach. See DS/DD coverage gap noted in the 2026-08-03 birds-eye review — no DS/DD doc exists
yet for this domain despite it being fully built.

Not yet built: viewings, offers, reservation, closing as distinct workflow stages (they exist
only as manual pipeline-stage labels with no automation behind them — see Transaction
Management below).

---

## Seller Operations — **Future**

Not started, beyond what Property Management/Listing Management already cover (onboarding,
verification, listing preparation). Buyer engagement and sale completion as distinct workflow
concepts don't exist.

---

## Transaction Management — **Future**

Not started. Deals, offers, contracts, reservations, closing, documentation as a distinct
domain — none of this exists in code.

---

## Commission Management — **Future**

Not started. No commission structures, splits, earnings, or payouts exist anywhere in the
schema or backend.

---

## Task & Workflow Engine — **Partially Built**

Built (`cap-tasks-001`, shipped 2026-07-28): a real Task entity with a standalone Tasks page,
admin-configurable per-event routing settings (assign to a specific person or "the tenant's
admin"), and auto-generation on every buyer-requirement pipeline stage change. Still not a
general-purpose workflow engine — task types and triggers are hardcoded per business event, not
user-definable. The separate automated-notification pattern (TS-003) still covers the earlier,
narrower "Automations"/"Notifications" slice (contract expiry, training reminders,
listing-authority expiry) — that pattern and the Task entity are two different mechanisms, not
merged into one.

Not yet built: user-definable task types/triggers, a general workflow-automation builder.

---

## Document Management — **Partially Built**

Built: Property Documents (title deeds, tax declarations — DD-008). Not yet built: a general
document store for contracts, IDs, or other document types beyond property-attached files.

---

## Reporting & Analytics — **Partially Built**

Built (`cap-analytics-001`, shipped 2026-07-28): a Performance page tracking share events
(`listing_share_events`) — how often/where a listing's share text was generated, one slice of
distribution effectiveness, not general pipeline or financial reporting.

Not yet built: general dashboards, buyer-pipeline analytics, financial/commission reporting.

---

## AI Services — **Mostly Future; migration-mapping assist is Built differently than originally scoped**

Originally scoped as customer-provided AI providers (OpenAI/Anthropic/Gemini) assisting
migration, validation, matching, document drafting, search, summarization, and automation.

**As implemented, 2026-07-27**: there is no live AI/LLM call anywhere in the application. Field
mapping for CSV migration uses a deterministic header-string matcher (TS-004); genuine
AI-assisted mapping happens in an external Claude session an operator runs outside the app, not
an in-app customer-provided-key integration. Data validation/preview/dedup/rollback (the
"zero-trust migration" guarantee) are built, but as deterministic backend logic, not AI. Every
other listed capability (matching assistance, document drafting, search, summarization, general
automation) is unstarted. See CTX-003's AI Integration section for the full correction.

---

# Cross-Cutting Principles

Every business domain should support:

## Workspace Isolation

Brokerages never share operational data unless explicitly configured.

---

## Configurability

Business behavior should be driven by configuration rather than code whenever practical.

---

## Auditability

Important actions should be traceable.

---

## Security

Customer trust is a product feature.

---

## Automation

Automation assists people rather than replacing business judgment.

---

# Business Lifecycle

Residoro's target design supports the complete lifecycle of brokerage operations:

```
Lead
    ↓
Qualification
    ↓
Matching
    ↓
Viewing
    ↓
Offer
    ↓
Negotiation
    ↓
Contract
    ↓
Closing
    ↓
Commission
    ↓
Reporting
```

**As implemented, 2026-07-27, this diagram is entirely aspirational** — Buyer Operations,
Transaction Management, and Commission Management (the domains this lifecycle depends on) are
all unbuilt. What's actually built today is the layer *underneath* this lifecycle: Property
onboarding, Listing creation and marketing authority, and — the domain this document originally
omitted — the Client Lifecycle that gets a brokerage onto the platform in the first place. The
buyer/seller transaction lifecycle above remains the intended long-term direction, not current
functionality.

Seller workflows follow a parallel lifecycle beginning with property onboarding and authority to
sell before entering active marketing — this half is real today (Property Management + Listing
Management, both Built above); it just doesn't yet continue into buyer engagement or sale
completion.

---

# Product Design Principles

Residoro is designed around:

- Business entities rather than screens.
- Processes rather than pages.
- Relationships rather than isolated records.
- Configuration rather than customization.
- Long-term scalability rather than short-term convenience.

---

# Success Criteria

Residoro succeeds when:

- Every brokerage department operates from the same platform.
- Migration from legacy systems is predictable and low-risk.
- Operational knowledge is preserved.
- Customer data remains secure and isolated.
- The platform scales without architectural redesign.

---

# Future Expansion

The architecture intentionally supports future capabilities, including:

- Mobile applications
- Public APIs
- Third-party integrations
- Marketplace integrations
- AI copilots
- Advanced analytics
- Workflow orchestration

without requiring changes to the core business architecture.

---

# Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-20 | Initial version. |
| 2.0.0 | 2026-07-27 | Refreshed from a birds-eye technical review: added Built/Partially Built/Future status to every business domain (verified against actual code, not aspirational); added the Client Lifecycle domain, missing from the original PRD entirely despite being one of the most fully-built parts of the platform; flagged the Business Lifecycle diagram and AI Services section as largely aspirational relative to current implementation. Structural revision, hence major version bump per STD-002. |
| 2.1.0 | 2026-08-03 | Refreshed from a 2026-08-03 birds-eye review: a full day of feature work (2026-07-28) landed the day immediately after this doc's last revision and was never reflected here. Flipped Buyer Operations, Task & Workflow Engine, and Reporting & Analytics from Future to Partially Built; updated the CRM section for Company/Buyer/Developer-consolidation. |
| 2.1.1 | 2026-08-08 | `tb-listings-rent-to-lease-001`: Listing Management summary corrected from "sale/rent" to "sale/lease" (that `listing_type` enum value was renamed app-wide). |