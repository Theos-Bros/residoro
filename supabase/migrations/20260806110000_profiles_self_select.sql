-- ============================================================================
-- Migration: profiles -- self-select RLS policy
-- Implements: tb-user-profile-display-name-001 (theos-registry)
--
-- profiles_select_same_tenant (`tenant_id = current_tenant_id()`) is the only
-- existing SELECT policy on profiles. For an operator, both sides of that
-- comparison are NULL (operators have tenant_id = null, and current_tenant_id()
-- looks up the caller's own row), and `null = null` is not true in Postgres --
-- so an operator could not read even their own profile row through a
-- scoped/RLS-enforced client. This blocked this tracer bullet's shared
-- GET /me/profile route (ADR-003 prefers a scoped client over supabaseAdmin
-- for user-facing routes) from working for operators.
--
-- profiles_select_own mirrors profiles_update_own's shape exactly (`id =
-- (select auth.uid())`, no tenant_id involved) -- self-read of one's own row
-- is safe for every role, tenant-scoped or not. Additive: does not replace or
-- narrow profiles_select_same_tenant, which still governs teammate visibility.
-- ============================================================================

create policy profiles_select_own on public.profiles
  for select
  using (id = (select auth.uid()));
