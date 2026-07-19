# CTX-002 — Product Architecture

**Status:** Approved  
**Version:** 1.0.0  
**Owner:** Residoro Engineering  
**Created:** 2026-07-20  
**Last Updated:** 2026-07-20

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
- ADR-006 — Workspace Isolation

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

## Identity

Manages:

- Organizations
- Workspaces
- Users
- Roles
- Permissions

---

## CRM

Manages:

- Contacts
- Companies
- Buyers
- Sellers
- Owners
- Developers

---

## Property Management

Manages:

- Properties
- Units
- Amenities
- Media
- Documents
- Verification

---

## Listing Management

Manages:

- Listings
- Authority to Sell
- Pricing
- Marketing
- Publication
- Availability

---

## Buyer Operations

Supports:

- Lead intake
- Qualification
- Property matching
- Viewings
- Offers
- Reservation
- Closing

---

## Seller Operations

Supports:

- Property onboarding
- Verification
- Listing preparation
- Marketing
- Buyer engagement
- Sale completion

---

## Transaction Management

Manages:

- Deals
- Offers
- Contracts
- Reservations
- Closing
- Documentation

---

## Commission Management

Manages:

- Commission structures
- Splits
- Agent earnings
- Brokerage earnings
- Payouts

---

## Task & Workflow Engine

Coordinates:

- Checklists
- Tasks
- Assignments
- Automations
- Notifications

---

## Document Management

Stores:

- Contracts
- IDs
- Property documents
- Images
- Videos
- Attachments

---

## Reporting & Analytics

Provides:

- Brokerage health
- Sales performance
- Agent performance
- Pipeline analytics
- Financial reporting

---

## AI Services

Supports:

- Data migration
- Data validation
- Matching assistance
- Document drafting
- Search
- Summarization
- Automation

Brokerages retain ownership of their AI providers and API keys.

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

Residoro supports the complete lifecycle of brokerage operations.

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

Seller workflows follow a parallel lifecycle beginning with property onboarding and authority to sell before entering active marketing.

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