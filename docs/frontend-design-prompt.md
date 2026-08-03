# Frontend Design Prompt — Residoro

**Purpose:** A standing, copy-pasteable prompt for briefing Claude on a frontend design pass
over Residoro's UI. Not part of the CTX→ADR→STD→BPM→CAP→DS→DD→TS reading order in
`docs/README.md` — this is a working input for a design session, not an architecture doc.
Kept here so it can be found again instead of re-derived from scratch.

**Last updated:** 2026-08-03. Update the "Current surface area" section whenever pages or
modals are added/removed/renamed, so the prompt doesn't go stale.

---

## How to use this

Paste everything in the fenced block below into a fresh Claude conversation (or Claude Design
mode) when you want a frontend design/UX pass. Fill in the "Focus for this pass" line first —
don't run it unscoped over all 17 pages at once.

---

```
You're doing a frontend design and UX pass on Residoro, a "Brokerage Operating System" for
Philippine real estate brokerages — a multi-tenant, invite-only, operator-run back-office
platform (not self-serve SaaS). It manages the full operational lifecycle of a brokerage:
properties, listings, leads, contacts, developer projects, docket sharing, and client
lifecycle/training — not just a single function like CRM.

## Stack (don't change without saying so first)
- React 18 + TypeScript + Vite
- Tailwind CSS (utility-first, no CSS-in-JS)
- Radix UI primitives (@radix-ui/react-dialog, react-label, react-separator, react-slot)
- class-variance-authority + tailwind-merge for variant-driven components
- lucide-react for icons
- react-router-dom for routing
- No component library (no shadcn/mui/chakra) — components in src/components/ui/ are hand-rolled
  on top of Radix primitives (currently just dialog.tsx)

## Current surface area (application/frontend/src/)
Pages (src/pages/, 17 total):
AcceptInvitePage, AuthPage, ContactsPage, LeadsPage, ListingsPage, NewProjectForm,
NewPropertyListingForm, PerformancePage, ProjectDetailPage, ProjectsListPage,
PropertiesListPage, PropertyDetailPage, RevisitPage, SearchPage, SettingsPage,
ShareDocketForm, SharedWithMePage, TasksPage

Admin console (src/admin/, separate app mounted at an admin route):
AdminLayout, ClientList, ClientMigration, NewClientForm, TrainingOverview,
TrainingScheduleForm

Modals (src/components/, all built on src/components/ui/dialog.tsx):
BroadcastModal, ConfirmImportModal, ConfirmRemoveMemberModal, ConfirmRemoveUnitsModal,
ListingDetailModal, QualifyInquiryModal, ShareDetailsModal

## Non-negotiable requirements for this pass
1. **Every page and every modal needs a description** — a short, visible line (subtitle/helper
   text under the page title, or in the modal header under the dialog title) that tells the user
   what this screen/modal is for and what they're expected to do here. Don't rely on the title
   alone to carry that. Call out any page/modal above that currently has no such description.
2. **Form follows function.** Justify every layout/visual decision by the task the screen exists
   to support — don't propose decoration, visual flourishes, or layout changes that don't serve
   the user's actual job on that screen. If a change is purely aesthetic, say so explicitly and
   let it be judged on its own, not bundled in as if it were functionally motivated.
3. Keep it inside the current stack (Tailwind + Radix + lucide-react). Don't introduce a new UI
   library or design-token system as part of this pass unless you flag it as a separate proposal.
4. Consistency across the surface area matters more than any single screen looking great in
   isolation — this is a back-office tool used daily by brokerage staff, not a marketing site.
   Flag inconsistencies (spacing, type scale, button/empty-state/error-state patterns) across the
   pages and modals listed above, not just within one screen.

## Focus for this pass
<Fill in: e.g. "all 7 modals" / "PropertiesListPage + PropertyDetailPage + the 4 modals they
open" / "the description requirement only, across all 17 pages" — don't leave this blank>

## What I want back
- Concrete before/after for each screen in scope (description text to add, specific layout
  changes, component-level diffs) — not a general design philosophy essay.
- Call out anything in scope that's already fine as-is; don't manufacture changes to look busy.
- If a proposed change touches shared components (src/components/ui/), say which other
  pages/modals it will also affect.
```

---

## Notes for whoever runs this

- Confirm the "Current surface area" list above still matches `application/frontend/src/`
  before pasting — pages/modals get added over time and this file won't auto-update.
- If the resulting design changes get implemented, they should land as normal residoro commits
  following the existing STD-002 documentation/engineering standards — this prompt doesn't
  replace that process, it just kicks off the design thinking.
