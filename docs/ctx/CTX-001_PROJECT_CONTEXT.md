# CTX-001 — Project Context

**Status:** Approved  
**Version:** 1.0.1  
**Owner:** Residoro Engineering  
**Created:** 2026-07-20  
**Last Updated:** 2026-07-21

---

# Purpose

This document defines the purpose, philosophy, guiding principles, and long-term vision of Residoro.

It serves as the constitutional document of the project. Every architectural, product, and engineering decision should align with the principles defined here.

---

# Scope

This document describes:

- Why Residoro exists
- The problems it solves
- The principles that guide development
- The long-term vision for the platform

Implementation details are intentionally excluded and documented elsewhere.

---

# Related Documents

- CTX-000 — Context Index
- CTX-002 — Product Context
- CTX-003 — Engineering Context
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation

---

# Mission

To build the operating system that enables Philippine real estate brokerages to manage their entire business with confidence, efficiency, and trust.

Residoro exists to simplify brokerage operations while protecting the data, relationships, and reputation that brokerages have spent years building.

---

# Vision

Residoro aims to become the standard operating platform for Philippine real estate brokerages.

The platform is designed to support brokerages of all sizes, from small independent firms to large organizations, through a secure, configurable, and scalable multi-tenant architecture.

---

# The Problem

Most brokerages operate using a collection of disconnected tools:

- Spreadsheets
- Messaging applications
- Shared drives
- Notion workspaces
- CRM systems
- Manual processes

This fragmentation results in:

- Duplicate data
- Inconsistent workflows
- Lost opportunities
- Poor reporting
- Difficult onboarding
- High operational overhead

Migration to modern systems is often avoided because brokerages fear disrupting daily operations or losing valuable historical data.

---

# Why Residoro Exists

Residoro is built to solve three fundamental challenges:

## 1. Operational Fragmentation

Brokerages need one platform that manages the complete lifecycle of their business rather than isolated functions.

---

## 2. Trust

Brokerages are highly protective of:

- Listings
- Client relationships
- Commission structures
- Internal processes

Trust is therefore treated as a core product feature rather than an afterthought.

---

## 3. Migration

The greatest barrier to adopting new software is the migration itself.

Residoro prioritizes AI-assisted migration with staging, validation, mapping, previews, and user approval before production imports.

Migration should become a competitive advantage rather than a barrier.

---

# Product Philosophy

Residoro is not a CRM.

Residoro is a Brokerage Operating System.

The platform manages the complete operational lifecycle of a brokerage, including:

- Contacts
- Companies
- Buyers
- Sellers
- Properties
- Listings
- Deals
- Documents
- Tasks
- Automation
- Commissions
- Reporting
- Analytics
- AI-assisted workflows

---

# Core Principles

## Business Before Software

Technology exists to support brokerage operations—not define them.

Business processes are designed before database schemas, APIs, or user interfaces.

---

## Documentation Before Development

Architecture is documented before implementation.

Documentation evolves alongside source code and remains the authoritative reference.

---

## Configuration Before Customization

Behavior should be configurable through data whenever practical.

Hardcoded business logic should be avoided.

---

## Trust By Design

Every architectural decision should reinforce customer trust.

Examples include:

- Workspace isolation
- Row Level Security
- Audit trails
- Permission-based access
- Customer ownership of data

---

## AI As An Assistant

AI augments brokerage operations.

It assists with migration, automation, search, drafting, and analysis while keeping human professionals responsible for business decisions.

Brokerages retain control of their AI providers and API keys.

---

## Long-Term Thinking

Every significant decision should be evaluated against the following questions:

- Does this improve brokerage operations?
- Does this increase customer trust?
- Does this reduce migration friction?
- Does this protect customer data?
- Does this scale to thousands of brokerages?
- Will this still be the correct decision five years from now?

---

# Definition of Success

Residoro succeeds when a brokerage can operate its entire business from a single trusted platform without sacrificing control over its data or disrupting existing operations.

---

# Non-Goals

Residoro does not aim to:

- Become a public property marketplace
- Force brokerages into rigid workflows
- Encourage unnecessary data sharing between brokerages
- Replace professional brokers with AI

---

# Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-20 | Initial version. |