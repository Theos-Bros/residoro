# STD-002 — Documentation Standards

**Status:** Approved  
**Version:** 1.2.0  
**Owner:** Residoro Engineering  
**Created:** 2026-07-20  
**Last Updated:** 2026-07-27

---

# Purpose

This standard defines how engineering documentation is written, organized, versioned, and maintained throughout the Residoro repository.

Documentation is considered a production asset and follows the same engineering discipline as source code.

---

# Scope

This standard applies to every engineering document in the repository, including:

- CTX
- ADR
- STD
- BPM
- CAP
- DS
- DD
- TS
- API
- RFC

---

# Guiding Principles

Documentation should be:

- Accurate
- Version controlled
- Single-purpose
- Discoverable
- Cross-referenced
- Maintainable
- Readable by both humans and AI

---

# Single Responsibility Principle

Every document should answer one primary question.

Examples:

| Document | Responsibility |
|-----------|----------------|
| CTX | Project knowledge |
| ADR | Architectural decisions |
| STD | Engineering conventions |
| BPM | Business workflows |
| CAP | Platform capabilities |
| DS | Database architecture |
| DD | Database schema |
| TS | Technical implementation |
| API | HTTP contract (routes, auth, request/response shape) |
| RFC | Open proposal, not yet decided |

Documents should not duplicate responsibilities.

RFCs are not part of the authority chain below. They exist *before* a decision is made — once
resolved, an RFC's outcome is recorded either as a new/superseding ADR (architectural decisions)
or as an STD update (process/convention decisions), and the RFC itself is marked `Approved`
(decision recorded) or `Deprecated` (abandoned) rather than promoted into the hierarchy directly.
An RFC should only be written for a genuine judgment call with more than one defensible option —
not for corrections with an obviously right answer.

---

# Standard Document Structure

Every engineering document begins with:

```markdown
# Document Title

**Status:** Draft | Approved | Deprecated
**Version:** x.y.z
**Owner:** Residoro Engineering
**Created:** YYYY-MM-DD
**Last Updated:** YYYY-MM-DD

---

## Purpose

...

---

## Scope

...

---

## Related Documents

- ...

---
```

---

# Status Values

Every document must declare one status.

| Status | Meaning |
|----------|---------|
| Draft | Under development |
| Approved | Official reference |
| Deprecated | No longer authoritative |

---

# Versioning

Documentation follows Semantic Versioning.

Examples:

| Version | Meaning |
|-----------|---------|
| 1.0.0 | Initial approved version |
| 1.1.0 | New sections added |
| 1.1.1 | Minor corrections |
| 2.0.0 | Breaking structural revision |

---

# Naming Convention

Every filename follows:

```
TYPE-NNN_DESCRIPTIVE_NAME.md
```

Examples:

```
CTX-001_PROJECT_CONTEXT.md
ADR-003_MULTI_TENANT_ARCHITECTURE.md
STD-004_NAMING_STANDARDS.md
DD-101_CONTACTS.md
```

---

# Cross References

Documents should reference related artifacts whenever applicable.

Examples:

Related Documents

- CTX-001 Project Context
- ADR-006 Workspace Isolation
- DS-100 Contact Management
- DD-100 Contacts

Documentation should form a connected knowledge graph rather than isolated pages.

---

# Source of Truth

Authority flows in the following order:

```
CTX
    ↓
ADR
    ↓
STD
    ↓
BPM
    ↓
DS
    ↓
DD
    ↓
TS
    ↓
Source Code
```

Source code should implement the documentation.

Documentation defines the intended architecture.

---

# AI Compatibility

Documentation should be written so that AI assistants can:

- Read sequentially
- Follow cross references
- Understand architectural intent
- Avoid inventing undocumented behavior

Documents should avoid ambiguity and duplicated concepts.

---

# Review Guidelines

Documentation should be updated whenever:

- Architecture changes
- Business rules change
- Database schema changes
- Engineering standards evolve

Documentation updates should accompany implementation changes whenever possible.

---

# Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-20 | Initial documentation standard. |
| 1.1.0 | 2026-07-27 | Added RFC as a document type (open proposals, pre-decision), with its relationship to ADR/STD clarified. |
| 1.2.0 | 2026-07-27 | Added API as a document type — the HTTP contract (routes/auth/request-response shape), distinct from TS (implementation detail/rationale) and DD (database schema). `docs/api/` existed as a folder before this but had no defined type. |