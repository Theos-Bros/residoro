# Residoro Engineering Documentation

Welcome to the Residoro engineering knowledge base.

This documentation defines the business, architecture, engineering standards, database design, and implementation strategy for Residoro.

Documentation is considered a production asset and evolves alongside the source code.

---

# Documentation Reading Order

Every new engineer, contributor, or AI assistant should read the documentation in the following order.

## 1. Context (CTX)

Understand why Residoro exists.

- CTX-000 — Context Index
- CTX-001 — Project Context
- CTX-002 — Product Context
- CTX-003 — Engineering Context
- CTX-004 — AI Guidelines
- CTX-005 — Current Status
- CTX-006 — Roadmap
- CTX-007 — Glossary

---

## 2. Architecture (ADR)

Read architectural decisions before implementation.

Location:

```
docs/adr/
```

---

## 3. Engineering Standards (STD)

Read engineering conventions and implementation standards.

Location:

```
docs/std/
```

---

## 4. Business Process Models (BPM)

Understand brokerage operations before designing software.

Location:

```
docs/bpm/
```

---

## 5. Capabilities (CAP)

Understand what the platform does independently of implementation.

Location:

```
docs/cap/
```

---

## 6. Database Specifications (DS)

Understand business entities and relationships.

Location:

```
docs/ds/
```

---

## 7. Data Dictionary (DD)

Understand tables, columns, and constraints.

Location:

```
docs/dd/
```

---

## 8. Technical Specifications (TS)

Understand APIs, integrations, modules, and implementation details.

Location:

```
docs/ts/
```

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

---

# Documentation Principles

Residoro follows a documentation-first engineering methodology.

Every implementation should follow this sequence:

```
Business Process
        ↓
Architecture Decision
        ↓
Engineering Standard
        ↓
Database Specification
        ↓
Data Dictionary
        ↓
SQL Migration
        ↓
Backend
        ↓
Frontend
```

---

# Repository Layout

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

# Current Progress

## Context

- ✅ CTX-000 Context Index
- ✅ CTX-001 Project Context
- ✅ CTX-002 Product Context
- ✅ CTX-003 Engineering Context
- ✅ CTX-004 AI Guidelines
- ✅ CTX-005 Current Status
- ✅ CTX-006 Roadmap
- ✅ CTX-007 Glossary

---

## Architecture (ADR)

- ✅ ADR-001 Shared-Schema Multi-Tenant Architecture
- ✅ ADR-002 Workspace Isolation & Row-Level Security
- ⏳ ADR-003 Configuration Over Customization
- ⏳ ADR-004 Documentation-First Development
- ⏳ ADR-005 AI-Assisted Migration
- ⏳ ADR-006 Workspace Naming Convention

---

## Engineering Standards (STD)

- ✅ STD-002 Documentation Standards
- ⏳ STD-001 Engineering Principles (referenced by CTX-004, not yet written)

---

Residoro documentation is continuously evolving. Every architectural change should be reflected in the documentation before implementation.