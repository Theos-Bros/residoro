-- ============================================================================
-- Migration: Fix signup privilege escalation
-- Fixes: CRITICAL finding in docs/security-review-2026-07-29.md
--
-- handle_new_user() previously trusted raw_user_meta_data->>'app_role' and
-- ->>'tenant_id' to decide whether a new auth.users row became a platform
-- operator or joined an existing workspace as admin. That field is the
-- `data` payload of Supabase Auth's own public POST /auth/v1/signup
-- endpoint -- reachable with only the publishable key, independent of
-- whether this app's UI exposes a signup form. The 2026-07-29 review proved
-- live that a single unauthenticated curl call could self-grant role
-- 'operator' or hijack any existing workspace as its admin.
--
-- Fix: the trigger no longer reads any privilege-bearing field from
-- raw_user_meta_data. Every new profile starts fully inert -- no tenant, no
-- privileged role -- via the existing 'member' role and NULL tenant_id,
-- which requireAuth already rejects with 401 "No workspace found for this
-- user" and requireOperator already rejects with 403. The two paths that
-- ever grant real access (POST /admin/clients, create-operator.ts) now
-- assign tenant_id/role via a service-role UPDATE keyed by the invite
-- response's own auth.users id, immediately after inviteUserByEmail
-- succeeds -- never by anything the invitee supplied. See the accompanying
-- backend changes to admin.ts and create-operator.ts.
--
-- This also drops the old "auto-create a new workspace + become its admin"
-- default branch (the "DS-001 placeholder for direct signup" mentioned in
-- 20260722100000_operator_role.sql) -- that branch is itself inconsistent
-- with cap-client-lifecycle-001's invite-only model now that it's the only
-- thing left for an uninvited signup to reach. Disabling public signups at
-- the Supabase Auth project level (Dashboard) closes the remaining path
-- entirely; this migration is the defense-in-depth backstop that holds even
-- if that project setting ever drifts back on.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, tenant_id, role, full_name)
  values (new.id, null, 'member', new.raw_user_meta_data ->> 'full_name');

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Always creates an inert profile (role=member, tenant_id=null) regardless of '
  'signup metadata -- privilege is assigned only by a trusted service-role UPDATE '
  'from POST /admin/clients or create-operator.ts, keyed by the auth.users id those '
  'trusted callers already control. See 2026-07-29 security review.';
