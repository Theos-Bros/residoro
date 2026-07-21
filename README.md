# Residoro

> **The Brokerage Operating System for Philippine real estate brokerages.**

Residoro is a multi-tenant SaaS platform designed to manage the complete operational lifecycle of a real estate brokerage—from lead acquisition and property onboarding to transactions, commissions, reporting, and AI-assisted workflows.

Unlike traditional CRMs, Residoro is designed as a **Brokerage Operating System (Brokerage OS)**, where business processes, data integrity, automation, and trust are treated as first-class citizens.

---

## Vision

To become the operating system that powers every Philippine real estate brokerage through secure, configurable, and scalable software.

---

## Core Principles

- Business process before user interface.
- Database before implementation.
- Documentation before development.
- Configuration before hardcoding.
- Multi-tenant by design.
- Security and trust are product features.
- AI augments brokerage operations, not replaces professional judgment.

---

## Technology Stack

| Layer | Technology |
|--------|------------|
| Frontend | React + TypeScript (Vite) |
| Application Backend | Node.js + TypeScript (Fastify) |
| Backend-as-a-Service | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth |
| Storage | Supabase Storage |
| Search | PostgreSQL Full Text Search *(Elasticsearch planned)* |
| AI | OpenAI · Anthropic Claude · Google Gemini (brokerage-managed API keys) |

---

## Repository Structure

```text
.
├── .github/
├── application/
├── archive/
├── docs/
├── infrastructure/
├── operations/
└── tools/
```

---

## Documentation

Residoro follows a documentation-first engineering workflow.

```
CTX → Project Context
ADR → Architecture Decision Records
STD → Engineering Standards
BPM → Business Process Models
CAP → Platform Capabilities
DS  → Database Specifications
DD  → Data Dictionary
TS  → Technical Specifications
```

Documentation lives inside the `/docs` directory and evolves alongside the source code.

---

## Development Workflow

Every implementation follows the same sequence:

```text
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

The user interface is the final expression of the architecture—not the starting point.

---

## Project Status

Current milestone:

**Repository Foundation**

---

## License

License to be determined.