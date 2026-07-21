-- ============================================================================
-- Migration: Platform Foundation Hardening
-- Follow-up to 20260721120000_platform_foundation.sql, addressing
-- get_advisors findings (security + performance) surfaced right after the
-- initial apply. Per DD-001/DD-002/ADR-002, fixed here as a new migration,
-- not by hand-editing the one already applied.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECURITY: tighten function EXECUTE grants to least privilege
-- ----------------------------------------------------------------------------
-- current_tenant_id()/current_role() back RLS policies for the `authenticated`
-- role only -- `anon` has no RLS-gated access anywhere in this schema and
-- never needs to call them directly.
revoke execute on function public.current_tenant_id() from anon;
revoke execute on function public.current_role() from anon;

-- Trigger functions must never be directly callable via the exposed REST RPC
-- surface. Postgres itself rejects calling a trigger-return-type function
-- outside trigger context, but new functions get EXECUTE granted to PUBLIC
-- by default -- revoke that explicitly rather than relying on the runtime
-- error as the only guard. Trigger firing itself is unaffected: the trigger
-- mechanism invokes the function regardless of the issuing role's function
-- grants, since it isn't an explicit SQL call by that role.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.set_updated_at() from public;

-- ----------------------------------------------------------------------------
-- PERFORMANCE: cover the one unindexed FK the advisor flagged
-- ----------------------------------------------------------------------------
create index if not exists idx_properties_created_by on public.properties (created_by);

-- ----------------------------------------------------------------------------
-- PERFORMANCE: wrap auth.uid()/helper-function calls in RLS policies with
-- `(select ...)` so Postgres evaluates them once per query instead of once
-- per row. The advisor flagged profiles_update_own specifically (direct
-- auth.uid() call); applying the same fix to every policy using the same
-- shape for consistency, since they'd hit the same per-row cost at scale.
-- ----------------------------------------------------------------------------
drop policy if exists workspaces_select_own on public.workspaces;
create policy workspaces_select_own on public.workspaces
  for select
  using (id = (select public.current_tenant_id()));

drop policy if exists workspaces_update_admin on public.workspaces;
create policy workspaces_update_admin on public.workspaces
  for update
  using (id = (select public.current_tenant_id()) and (select public.current_role()) = 'admin')
  with check (id = (select public.current_tenant_id()));

drop policy if exists profiles_select_same_tenant on public.profiles;
create policy profiles_select_same_tenant on public.profiles
  for select
  using (tenant_id = (select public.current_tenant_id()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists properties_select_tenant on public.properties;
create policy properties_select_tenant on public.properties
  for select
  using (tenant_id = (select public.current_tenant_id()));

drop policy if exists properties_insert_tenant on public.properties;
create policy properties_insert_tenant on public.properties
  for insert
  with check (tenant_id = (select public.current_tenant_id()));

drop policy if exists properties_update_tenant on public.properties;
create policy properties_update_tenant on public.properties
  for update
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

drop policy if exists properties_delete_admin on public.properties;
create policy properties_delete_admin on public.properties
  for delete
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role()) = 'admin');
