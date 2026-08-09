-- ============================================================================
-- Migration: workspaces -- CRITICAL security fix, close accidental table-wide
-- update grant (same pattern as 20260810170000_profiles_grant_lockdown.sql)
--
-- `authenticated` held a table-wide `grant update on public.workspaces`
-- (20260721120000_platform_foundation.sql:247, never narrowed by any later
-- migration). Combined with workspaces_update_admin's row-only RLS check
-- (`id = current_tenant_id() and current_role() = 'admin'`, no column
-- restriction), any real admin of their own tenant could directly PATCH
-- access_state, contract_end_date, exclusivity_hard_block, or
-- rollback_window_hours via a plain PostgREST call -- all four documented in
-- DD-001 as operator/Edge-Function/system-set only, never client-writable.
-- Confirmed via docs/security-review-2026-07-29.md Finding 7 (scoped out at
-- the time to fix `profiles` first -- the more severe, full-tenant-takeover
-- gap) and independently re-derived + re-confirmed by a second review pass
-- the same day.
--
-- Fix: REVOKE ALL, then re-GRANT only `select`. Unlike `profiles`,
-- `workspaces` gets no `update` grant back at all -- grepping every
-- getScopedClient(...).from('workspaces') call in application/backend/src
-- shows exactly one, a read-only `.select()` in routes/workspace.ts
-- (GET /me/workspace-status). Every actual write to `workspaces` already
-- goes through `supabaseAdmin` (service_role, which holds `grant all` and is
-- unaffected by this revoke): admin.ts (enrollment, contract dates),
-- listings.ts (exclusivity_hard_block via the listings-policy route), and
-- the contract-expiry-check Edge Function (access_state, warning flags).
-- workspaces_update_admin's RLS policy is left in place unchanged -- with no
-- update grant behind it, it's simply unreachable via PostgREST, matching
-- profiles.position's "no authenticated grant at all" precedent for
-- operator/system-only columns.
-- ============================================================================

revoke all on public.workspaces from authenticated;

grant select on public.workspaces to authenticated;
