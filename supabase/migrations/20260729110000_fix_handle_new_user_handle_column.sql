-- ============================================================================
-- Migration: Fix handle_new_user() to keep generating profiles.handle
-- Follow-up to: 20260729090000_fix_signup_privilege_escalation.sql
--
-- That migration's CREATE OR REPLACE FUNCTION handle_new_user() was written
-- against 20260722110000_client_enrollment.sql's version of the function and
-- didn't account for 20260723100000_profiles_handle.sql's later extension,
-- which added profiles.handle (NOT NULL, unique) and made every insert
-- branch call generate_unique_handle() to populate it. Overwriting the
-- function without that call broke every signup outright (23502 NOT NULL
-- violation) -- caught immediately by re-running the security review's
-- exploit attempts against the fix, which is exactly what surfaced this.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_handle text;
begin
  new_handle := public.generate_unique_handle(new.email);

  insert into public.profiles (id, tenant_id, role, full_name, handle)
  values (new.id, null, 'member', new.raw_user_meta_data ->> 'full_name', new_handle);

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Always creates an inert profile (role=member, tenant_id=null) regardless of '
  'signup metadata -- privilege is assigned only by a trusted service-role UPDATE '
  'from POST /admin/clients or create-operator.ts, keyed by the auth.users id those '
  'trusted callers already control. See 2026-07-29 security review.';
