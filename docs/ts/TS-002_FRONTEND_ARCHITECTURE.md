# TS-002 — Frontend Architecture

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Document how the React frontend is structured and the implementation patterns applied across
it. Written from a 2026-07-27 birds-eye technical review.

---

## Scope

Covers `application/frontend/src/`. Does not cover any backend route's contract (`docs/api/`)
or the visual design system's component inventory in detail (`cap-design-system-001` in the
Theos Registry covers that at the product level).

---

## Stack & Structure

React 18 + TypeScript, Vite 5, React Router DOM 6, Tailwind CSS 3, shadcn/ui-pattern components
(Radix primitives + `class-variance-authority` + `tailwind-merge`). No state-management library
and no data-fetching library (no React Query/SWR) — every data-dependent page/component
hand-rolls `useState`+`useEffect`+`fetch()`, including a manual `cancelled` flag for race-safety.
Applied consistently (a real pattern, not accidental duplication), but duplicated across roughly
ten pages.

Two independently-gated route trees: the brokerage app (`BrokerageLayout`, `/`, `/properties`,
`/projects`, `/listings`, `/shared-with-me`) and a fully separate operator app (`AdminLayout`,
nested under `/admin/*` with its own `<Routes>`). `components/` is a flat directory (19 files,
no domain subfolders) mixing migration/listings/properties/units/contract-lifecycle concerns —
findable by naming convention today, a candidate for domain grouping as the feature count grows.

`lib/*Api.ts` — one file per backend resource area, each exporting typed functions wrapping
`fetch()` against `docs/api/`'s routes, throwing on non-OK response. The Supabase JS client
(`lib/supabaseClient.ts`) is used **only** for auth (`supabase.auth.*`) — every data operation
goes through the Fastify backend, never a direct `.from(...)` table call.

---

## Auth & Session

`useSupabaseSession()` subscribes once at the `App` root (not per-route) to avoid tearing down
the subscription when navigating between the brokerage and admin trees.
`useOperatorStatus(session)` calls `GET /admin/whoami` (API-001) to distinguish an operator
session, keyed off `session?.access_token` rather than the session object reference to dodge
unnecessary refetches when Supabase re-fires `INITIAL_SESSION` with a new object but the same
token. `useWorkspaceStatus(session)` polls `GET /me/workspace-status` (API-001) to drive the
contract-warning banner.

**Known duplication**: `BrokerageLayout.tsx` and `admin/AdminApp.tsx` each independently
implement the same three-state gate (`loading` → render nothing; `!session` → render
`AuthPage`; branch on `operatorStatus` to redirect operators/non-operators to the right tree) —
copy-pasted rather than a shared `<ProtectedRoute>`/`<RequireAuth>` component.

---

## Design System

`components/ui/` is a real, consistently-applied shadcn/ui foundation, but thin — 8 primitives
(`button`, `card`, `badge`, `input`, `label`, `separator`, `sheet`, `table`). No `dialog`/modal
primitive exists despite `@radix-ui/react-dialog` being installed, so `ConfirmImportModal.tsx`
and `FloatingPanel.tsx` (the listings-lifecycle overlay pattern) are plain non-portal `<div>`s by
explicit precedent-following, not by design. Recurring needs like a status `<Select>` are
handled with raw Tailwind class strings (e.g. `verificationSelectClass` in
`PropertiesListPage.tsx`) rather than a shared primitive.

---

## Known Gaps (as of 2026-07-27)

- No data-fetching abstraction — see Stack & Structure above; a `useQuery`-style hook or
  adopting a query library would collapse the repeated pattern.
- Duplicated auth-gating logic between `BrokerageLayout` and `AdminApp` — see Auth & Session.
- Hand-synced business rules between frontend and backend: `listingsApi.ts`'s
  `LISTING_STATUS_TRANSITIONS` is explicitly commented as manually mirroring the backend's
  state machine — no compile-time or codegen safety net (see TS-001's "no shared-types
  package" note).
- Inconsistent error-state affordance: `role="alert"` appears in 22 places, but 5 of 11
  top-level pages have none.

---

## Related Documents

- TS-001 — Backend Architecture (the `docs/api/`-documented routes this frontend calls)
- ADR-002 — Workspace Isolation & Row-Level Security
- `cap-design-system-001` (Theos Registry) — product-level design system capability

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written from a birds-eye technical review. |
