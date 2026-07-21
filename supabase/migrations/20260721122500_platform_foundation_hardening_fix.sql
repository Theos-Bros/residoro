-- ============================================================================
-- Migration: Platform Foundation Hardening Fix
-- Follow-up to 20260721121500_platform_foundation_hardening.sql.
--
-- That migration revoked EXECUTE on current_tenant_id()/current_role() from
-- `anon` specifically, and on handle_new_user()/set_updated_at() from
-- `PUBLIC` specifically -- but get_advisors still showed the same warnings
-- afterward. Root cause, confirmed via has_function_privilege(): a
-- role-specific revoke doesn't remove access granted independently via the
-- PUBLIC pseudo-role, and Supabase's project-level default privileges grant
-- EXECUTE directly to `anon`/`authenticated` on every new function,
-- independent of PUBLIC. Revoking from all three targets (public, anon,
-- authenticated) and then re-granting exactly what's needed is what actually
-- closed the gap -- verified afterward with has_function_privilege() and a
-- clean get_advisors security pass (only the two accepted-by-design
-- authenticated-can-call-the-helpers warnings remain, per ADR-002).
-- ============================================================================

revoke execute on function public.current_tenant_id() from public, anon, authenticated;
revoke execute on function public.current_role() from public, anon, authenticated;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.current_role() to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
