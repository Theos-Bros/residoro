# CTX-000 — Context Index

**Status:** Approved  
**Version:** 1.0.0  
**Owner:** Residoro Engineering  
**Created:** 2026-07-20  
**Last Updated:** 2026-07-20

---

# Purpose

This document is the entry point to the Residoro knowledge base.

Residoro follows a documentation-first engineering methodology where architecture, business processes, engineering standards, and database design are documented before implementation.

Every developer, AI assistant, and contributor should begin here before reading any other project documentation.

---

# Documentation Philosophy

Residoro documentation is treated as a production asset.

Documentation evolves together with the source code and serves as the authoritative reference for business rules, architecture, engineering standards, and implementation decisions.

The repository—not any AI conversation—is the long-term source of truth.

---

# Documentation Hierarchy

```
CTX
    ↓
ADR
    ↓
STD
    ↓
BPM
    ↓
CAP
    ↓
DS
    ↓
DD
    ↓
TS
    ↓
SQL
    ↓
Application
```

Each document type has a single responsibility.

---

# Reading Order

Every new contributor or AI assistant should read the documentation in the following order.

## Phase 1 — Context

- CTX-000 Context Index
- CTX-001 Project Context
- CTX-002 Product Context
- CTX-003 Engineering Context
- CTX-004 AI Guidelines
- CTX-005 Current Status
- CTX-006 Roadmap
- CTX-007 Glossary

---

## Phase 2 — Architecture

Read all relevant Architecture Decision Records (ADR).

---

## Phase 3 — Standards

Read applicable Engineering Standards (STD).

---

## Phase 4 — Business

Read Business Process Models (BPM).

---

## Phase 5 — Database

Read Database Specifications (DS).

Read Data Dictionary documents (DD).

---

## Phase 6 — Implementation

Read Technical Specifications (TS), SQL migrations, backend code, and frontend implementation.

---

# Documentation Types

## CTX — Context

Provides high-level understanding of the project.

Examples:

- Vision
- Product
- Engineering
- AI
- Roadmap

---

## ADR — Architecture Decision Record

Captures architectural decisions.

Every significant architectural decision should have an ADR.

ADRs are immutable.

If a decision changes, a new ADR supersedes the previous one.

---

## STD — Engineering Standard

Defines conventions, naming rules, engineering practices, and implementation standards.

Standards evolve over time.

---

## BPM — Business Process Model

Documents brokerage workflows and operational processes.

Examples include:

- Buyer pipeline
- Seller pipeline
- Property onboarding
- Listing lifecycle

---

## CAP — Capability

Describes platform capabilities independently of implementation.

Capabilities explain what Residoro can do rather than how it is implemented.

---

## DS — Database Specification

Defines business entities, relationships, constraints, and database architecture.

---

## DD — Data Dictionary

Defines tables, columns, data types, constraints, and metadata.

---

## TS — Technical Specification

Documents implementation details for APIs, services, modules, integrations, and application behavior.

---

# Repository Structure

```
docs/
├── ctx/
├── adr/
├── std/
├── bpm/
├── cap/
├── ds/
├── dd/
├── ts/
├── diagrams/
└── api/
```

---

# Source of Truth

The following order determines authority whenever conflicts exist.

1. CTX
2. ADR
3. STD
4. BPM
5. DS
6. DD
7. TS
8. Source Code

Source code should reflect the documentation—not replace it.

---

# AI Guidelines

Every AI assistant contributing to Residoro should:

- Read the Context documents first.
- Never invent undocumented architecture.
- Never bypass ADRs.
- Prefer configuration over hardcoded logic.
- Think in business entities rather than screens.
- Preserve workspace isolation.
- Respect multi-tenant architecture.
- Keep business logic out of the frontend whenever possible.
- Update documentation when architecture changes.

---

# Document Metadata Standard

Every engineering document should begin with:

- Status
- Version
- Owner
- Created
- Last Updated

Future revisions may include:

- Review Date
- Related Documents
- Supersedes
- Superseded By

---

# Current Foundation Documents

| Document | Status |
|----------|--------|
| CTX-000 Context Index | ✅ Complete |
| CTX-001 Project Context | Planned |
| CTX-002 Product Context | Planned |
| CTX-003 Engineering Context | Planned |
| CTX-004 AI Guidelines | Planned |
| CTX-005 Current Status | Planned |
| CTX-006 Roadmap | Planned |
| CTX-007 Glossary | Planned |

---

# Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-20 | Initial document. |