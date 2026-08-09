-- ============================================================================
-- Migration: profiles -- admin-set position field
-- Implements: tb-employee-position-001 (theos-registry)
--
-- Deliberately NO grant to `authenticated`, unlike first_name/last_name/prefix.
-- Postgres column-level grants apply to the single shared `authenticated` role
-- regardless of the caller's app-level `role` column -- there is no way to
-- grant "only admins may update this column." The only correct enforcement is
-- no grant at all, service-role-only writes gated by an application-level
-- role==='admin' check (application/backend/src/routes/members.ts's new
-- PATCH /workspace/members/:id/position), mirroring how role/tenant_id are
-- already handled per DD-001. profiles_select_same_tenant/profiles_select_own
-- already expose this column on any readable row -- no new SELECT policy
-- needed.
-- ============================================================================

alter table public.profiles add column position text;

comment on column public.profiles.position is
  'Free-text job title/position (e.g. "Senior Agent"), admin-set only -- added '
  'by tb-employee-position-001. No client-facing update grant; mutated only '
  'via a trusted service-role route (PATCH /workspace/members/:id/position), '
  'same reasoning DD-001 already documents for role/tenant_id.';
