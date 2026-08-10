-- ============================================================================
-- Migration: tb-platform-grant-lockdown-001 -- close anon's dangling default
-- grant on profiles/workspaces. Finding 7's two fixes
-- (20260810170000_profiles_grant_lockdown.sql,
-- 20260810180000_workspaces_grant_lockdown.sql) each only ran
-- `revoke all ... from authenticated`, never touching anon -- Finding 8
-- caught this gap (docs/security-review-2026-07-29.md). Not currently
-- exploitable: profiles_select_own/profiles_update_own key off auth.uid(),
-- workspaces_select_own/workspaces_update_admin key off
-- current_tenant_id()/current_tenant_id_writable() (which themselves read
-- auth.uid()) -- all NULL for an unauthenticated anon request, so every
-- policy already evaluates false. Closing the dangling grant anyway per the
-- same "one future anon-reachable policy away" logic covering every other
-- table in this tracer bullet.
--
-- Every other table's anon revoke is folded into that table's own Tier 1/2/3
-- migration in this same tracer bullet; profiles/workspaces are the only two
-- tables that won't otherwise be touched again, hence this standalone pass.
-- ============================================================================

revoke all on public.profiles from anon;
revoke all on public.workspaces from anon;
