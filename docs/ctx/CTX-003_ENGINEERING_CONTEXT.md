# CTX-003 — Engineering Context

**Status:** Approved  
**Version:** 1.0.0  
**Owner:** Residoro Engineering  
**Created:** 2026-07-20  
**Last Updated:** 2026-07-20

---

# Purpose

This document defines the engineering philosophy, architectural constraints, technology stack, and development methodology of Residoro.

It answers the question:

> **How is Residoro engineered?**

While CTX-001 defines why the platform exists and CTX-002 defines what the platform is, this document establishes the engineering principles that guide implementation.

---

# Scope

This document covers:

- Engineering philosophy
- Platform architecture
- Technology stack
- Repository organization
- Development methodology
- Scalability principles
- Security principles
- Development workflow

Implementation details for specific features are documented elsewhere.

---

# Related Documents

- CTX-001 — Project Context
- CTX-002 — Product Architecture
- CTX-004 — AI Guidelines
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation
- ADR-003 — Configuration Over Customization
- ADR-004 — Documentation-First Development
- ADR-005 — AI-Assisted Migration
- ADR-006 — Workspace Naming Convention

---

# Engineering Philosophy

Residoro is engineered as a long-term Software-as-a-Service platform.

Engineering decisions prioritize:

- Simplicity
- Maintainability
- Scalability
- Security
- Customer trust
- Low operational overhead

The platform is designed to support thousands of brokerages without requiring architectural redesign.

---

# Engineering Principles

Development follows this sequence:

Business Process

↓

User Workflow

↓

Business Entities

↓

Relationships

↓

Permissions

↓

Automation

↓

Database

↓

APIs

↓

Frontend

User interfaces should reflect business architecture rather than define it.

---

# Platform Architecture

Residoro uses a shared-schema multi-tenant architecture.

Each brokerage operates within its own isolated workspace while sharing a common PostgreSQL schema.

Isolation is enforced through:

- Workspace ownership
- Row Level Security (RLS)
- Role-based permissions
- Application-level authorization

---

# Technology Stack

## Frontend

- WeWeb

Responsible for:

- User interface
- User experience
- Client-side interactions

Business logic should remain minimal.

---

## Backend

- Supabase

Provides:

- PostgreSQL
- Authentication
- Row Level Security
- Storage
- Edge Functions
- Realtime capabilities

---

## Database

- PostgreSQL

The database is the authoritative source of business data.

Business rules should be enforced at the database and backend layers whenever practical.

---

## AI Integration

Residoro supports customer-provided AI providers.

Supported providers may include:

- OpenAI
- Anthropic
- Google Gemini

API keys remain under customer control and should be encrypted at rest.

---

# Multi-Tenant Model

Residoro does not create separate databases or schemas per brokerage.

Instead:

- One database
- One shared schema
- Workspace isolation
- Tenant-aware business logic

This model simplifies maintenance while remaining highly scalable.

---

# Security Principles

Security is a product feature.

Engineering decisions should prioritize:

- Least privilege
- Secure defaults
- Auditability
- Data ownership
- Encryption
- Workspace isolation

---

# Configuration Philosophy

Whenever practical:

Configuration should replace code.

Business rules should be configurable through database records rather than hardcoded values.

Examples include:

- Pipelines
- Statuses
- Roles
- Permissions
- Automation rules
- Custom fields

---

# Migration Philosophy

Migration is treated as a core capability.

Residoro should support migration from:

- Notion
- Spreadsheets
- Legacy CRMs
- Custom databases

Imports should use:

- Staging
- Validation
- Mapping
- Preview
- User approval

Production data should never be modified without validation.

---

# Repository Organization

The repository separates:

- Documentation
- Application code
- Infrastructure
- Operations
- Tooling
- Archived assets

Documentation precedes implementation.

---

# Development Workflow

Major implementation work should follow:

1. Business process definition
2. Architecture decision
3. Engineering standards
4. Database specification
5. Data dictionary
6. SQL migration
7. Backend implementation
8. Frontend implementation
9. Testing
10. Documentation updates

---

# Testing Philosophy

Testing should occur at multiple levels:

- Database constraints
- RLS policies
- Backend logic
- API behavior
- Frontend workflows
- End-to-end business scenarios

Business-critical workflows should be validated before release.

---

# Deployment Philosophy

Development should progress through controlled environments.

Typical flow:

Development

↓

Testing

↓

Staging

↓

Production

Database migrations should be version-controlled and reversible whenever practical.

---

# Success Criteria

Residoro's engineering architecture succeeds when it:

- Scales to thousands of workspaces.
- Protects customer data.
- Supports rapid feature development.
- Maintains consistent architecture over time.
- Enables safe migrations and upgrades.

---

# Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-20 | Initial version. |