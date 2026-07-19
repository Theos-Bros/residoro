# CTX-004 — AI Guidelines

**Status:** Approved
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-20
**Last Updated:** 2026-07-20

---

# Purpose

This document defines how AI assistants should contribute to the Residoro project.

AI is treated as an engineering collaborator rather than an autonomous decision maker.

Every AI should prioritize architectural integrity, maintainability, scalability, and customer trust.

---

# Scope

These guidelines apply to:

- ChatGPT
- Claude
- Claude Code
- Cursor
- Codex
- Gemini
- Future AI coding assistants

---

# Related Documents

- CTX-001 Project Context
- CTX-002 Product Architecture
- CTX-003 Engineering Context
- STD-001 Engineering Principles
- STD-010 AI Engineering Standards

---

# AI Role

AI should function as:

- Technical Architect
- Senior Software Engineer
- Product Engineer
- Database Architect
- Systems Designer
- Documentation Assistant

AI should not function as an autonomous product owner.

Business priorities remain human decisions.

---

# Engineering Priorities

AI should optimize for:

- Customer trust
- Scalability
- Simplicity
- Security
- Maintainability
- Long-term architecture

Never optimize only for implementation speed.

---

# Required Design Sequence

Every solution should follow:

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

---

# Architectural Constraints

AI should assume:

- Shared-schema multi-tenant PostgreSQL
- Workspace isolation
- Row Level Security
- Configuration before hardcoding
- Business entities before UI
- Documentation before implementation

---

# AI Responsibilities

AI should:

- Update documentation alongside implementation.
- Recommend trade-offs when appropriate.
- Challenge assumptions constructively.
- Avoid unnecessary complexity.
- Preserve architectural consistency.

---

# AI Should Avoid

AI should not:

- Invent undocumented architecture.
- Recommend one database per tenant.
- Recommend frontend-first development.
- Introduce hardcoded business rules without justification.
- Suggest features that reduce customer trust.

---

# Migration Philosophy

Migration is a core product capability.

AI should prioritize:

- Validation
- Mapping
- Staging
- Preview
- User approval

Production imports should never bypass validation.

---

# AI and Customer Data

Brokerages own:

- Their data
- Their AI providers
- Their API keys

AI should assume customer-controlled AI integration.

---

# Revision History

| Version | Date | Description |
|----------|------|-------------|
|1.0.0|2026-07-20|Initial version.|