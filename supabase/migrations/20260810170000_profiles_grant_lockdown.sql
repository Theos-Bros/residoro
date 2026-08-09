-- ============================================================================
-- Migration: profiles -- CRITICAL security fix, close accidental table-wide grant
--
-- Discovered 2026-08-10 while verifying tb-employee-position-001's "no
-- client-facing grant on position" design: `authenticated` actually holds
-- FULL table-level privileges (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER) on public.profiles -- this was never explicitly
-- granted by any migration in this repo (every prior migration only ever
-- wrote `grant select on public.profiles to authenticated` and
-- `grant update (<specific column>) on public.profiles to authenticated`).
-- This is Supabase's default privilege behavior for new tables in the
-- `public` schema, and it was never revoked.
--
-- Impact, confirmed live against the linked "Residoro Prototype" project
-- with a disposable throwaway account (created, tested, deleted -- no real
-- data touched): profiles_update_own's RLS policy only restricts *which
-- row* (`id = auth.uid()`), never *which columns or values* -- so with the
-- table-level grant in place, ANY authenticated member could directly
-- UPDATE their own row's `role` to 'admin' or `tenant_id` to any other
-- workspace's id via a direct PostgREST call, bypassing the backend API
-- (and every "admin-only"/"service-role-only" application-level check)
-- entirely. This also silently defeated every column-level-grant-based
-- protection this repo's migrations and DD-001 have documented since day
-- one as the actual safeguard for role/tenant_id/handle, and would have
-- defeated tb-employee-position-001's "position has no client grant"
-- design the moment it shipped.
--
-- Fix: REVOKE ALL first (clears every implicit/default privilege
-- regardless of how it got there), then re-GRANT only what a client
-- legitimately needs: SELECT (RLS-scoped reads), and UPDATE on exactly the
-- columns already meant to be self-service (first_name, last_name, prefix).
-- No INSERT/DELETE grant -- profiles rows are only ever created via the
-- SECURITY DEFINER handle_new_user() trigger (which runs with elevated
-- privilege independent of the invoking role's own grants) and only ever
-- deleted via supabaseAdmin (service-role) in members.ts -- confirmed by
-- grepping the codebase for every getScopedClient(...).from('profiles')
-- call: none insert or delete, only select/update.
--
-- role, tenant_id, handle, and position remain correctly non-client-
-- writable after this fix -- exactly what DD-001 already claimed was true.
-- No RLS policy change: profiles_select_same_tenant/profiles_select_own/
-- profiles_update_own are unchanged; this is purely a grant-layer fix.
-- ============================================================================

revoke all on public.profiles from authenticated;

grant select on public.profiles to authenticated;
grant update (first_name, last_name) on public.profiles to authenticated;
grant update (prefix) on public.profiles to authenticated;
