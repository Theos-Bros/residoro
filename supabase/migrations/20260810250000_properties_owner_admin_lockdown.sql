-- ============================================================================
-- Migration: DB-level admin-only lockdown on properties.owner_type/owner_id
--
-- tb-properties-owner-admin-lockdown-001. Closes a residual gap flagged by
-- tb-platform-grant-lockdown-001 (see DD-002 v2.4.0's correction note, and the
-- comment above the `properties` grants in 20260810240000_tier1_grant_lockdown.sql):
-- `PATCH /properties/:id` (application/backend/src/routes/listings.ts, ~line 585)
-- rejects a non-admin's attempt to change owner_type/owner_id with a 403, but
-- that check is application-layer only. `properties_update_tenant`
-- (20260729100000_rls_access_state_enforcement.sql) is tenant-scoped, with no
-- role check, and both columns must stay grantable to `authenticated` for the
-- legitimate admin PATCH flow to work at all -- Postgres RLS can't express
-- "grantable column, but only when the acting role is admin" the way a
-- column-level GRANT expresses "grantable column, period." So today, any
-- tenant member can set property ownership directly via a PostgREST call,
-- bypassing the 403 entirely.
--
-- A BEFORE UPDATE trigger closes this without touching the existing PATCH
-- route, its RLS policy, or the column grant (still needed for the admin
-- path). Fires only on UPDATE -- POST /properties (creation) has no
-- role-check on owner_type/owner_id by design (confirmed during scoping, not
-- a gap), and CSV import is insert-only via the service-role client, so
-- neither path is touched by this trigger.
--
-- Role source: reuses public.current_role() (platform_foundation.sql), the
-- same SECURITY DEFINER helper already used by every other admin-gated RLS
-- policy in this schema (see e.g. properties_delete_admin,
-- workspaces_update_admin) -- no new role-resolution mechanism introduced.
--
-- owner_id's live nullability was confirmed via information_schema before
-- writing this: `owner_type` is `not null`, `owner_id` is nullable (it was
-- relaxed from its original not-null declaration by
-- 20260722130000_import_batches.sql for CSV-imported rows with no resolvable
-- owner target -- see DD-002's Deviations section). `IS DISTINCT FROM`
-- handles a NULL <-> non-NULL owner_id transition correctly either way, so no
-- special-casing was needed for that.
-- ============================================================================

create or replace function public.enforce_properties_owner_admin_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (new.owner_type is distinct from old.owner_type)
     or (new.owner_id is distinct from old.owner_id) then
    if public.current_role() is distinct from 'admin' then
      raise exception 'Only an admin can change property ownership'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.enforce_properties_owner_admin_only() is
  'BEFORE UPDATE trigger on public.properties: rejects (42501) any change to '
  'owner_type/owner_id from a non-admin actor. Mirrors the app-layer 403 in '
  'PATCH /properties/:id (routes/listings.ts) at the DB level, closing the '
  'direct-PostgREST bypass -- see tb-properties-owner-admin-lockdown-001.';

create trigger properties_owner_admin_lockdown
  before update on public.properties
  for each row execute function public.enforce_properties_owner_admin_only();
