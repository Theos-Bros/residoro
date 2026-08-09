-- ============================================================================
-- Migration: profiles -- split full_name into first_name/last_name
-- Implements: tb-user-profile-name-split-001 (theos-registry)
--
-- Replaces the single full_name column with first_name/last_name (structured
-- fields, per the user's explicit 2026-08-10 choice). Every existing
-- display-only consumer (Team list, task assignee pickers, the Permissions
-- grid) keeps working unchanged -- the backend routes that feed them now
-- compute a `full_name`-shaped display string server-side from first/last
-- instead of reading a raw column, so no frontend display component needs
-- to change. Only the self-edit surface (Profile Settings) and the three
-- backend routes that directly SELECT/ORDER on the old column change.
--
-- Following this repo's established convention (see DD-001's Signup
-- Provisioning section, and 20260729090000/20260729110000's own history):
-- never hand-edit an already-applied migration. handle_new_user() is
-- redefined here via CREATE OR REPLACE, same as every prior change to it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Add the new columns
-- ----------------------------------------------------------------------------
alter table public.profiles add column first_name text;
alter table public.profiles add column last_name text;

comment on column public.profiles.first_name is
  'Added by tb-user-profile-name-split-001, replacing full_name. Required at '
  'the API layer (PATCH /me/profile), nullable at the DB layer only because '
  'pre-existing rows are backfilled best-effort below.';
comment on column public.profiles.last_name is
  'Added by tb-user-profile-name-split-001, replacing full_name. Optional -- '
  'a single-token name (no space) backfills into first_name with last_name '
  'left null, same rule new signups follow via the redefined '
  'handle_new_user() below.';

-- ----------------------------------------------------------------------------
-- 2. Backfill existing rows: split full_name on the first space.
--    "Jane Dela Cruz" -> first_name "Jane", last_name "Dela Cruz" (everything
--    after the first space, not just the second token). A single-token name
--    ("Jane") -> first_name "Jane", last_name null. Null/blank full_name ->
--    both null, unchanged.
-- ----------------------------------------------------------------------------
update public.profiles
set
  first_name = case
    when position(' ' in btrim(full_name)) > 0
      then left(btrim(full_name), position(' ' in btrim(full_name)) - 1)
    else nullif(btrim(full_name), '')
  end,
  last_name = case
    when position(' ' in btrim(full_name)) > 0
      then nullif(btrim(substring(btrim(full_name) from position(' ' in btrim(full_name)) + 1)), '')
    else null
  end
where full_name is not null and btrim(full_name) <> '';

-- ----------------------------------------------------------------------------
-- 3. Grants: drop the old full_name grant, add one for first_name/last_name.
--    Same column-level shape and reasoning as before (see DD-001) --
--    profiles_update_own's row-level check is unchanged, still the only RLS
--    enforcement needed.
-- ----------------------------------------------------------------------------
revoke update (full_name) on public.profiles from authenticated;
grant update (first_name, last_name) on public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Drop full_name -- structural replacement, not an additive column.
-- ----------------------------------------------------------------------------
alter table public.profiles drop column full_name;

-- ----------------------------------------------------------------------------
-- 5. Redefine handle_new_user() to populate first_name/last_name instead of
--    full_name. Metadata key is still `full_name` (members.ts's invite route
--    and the direct-signup path both still send/accept a single Name field
--    at the point of invite/signup -- unchanged, deliberately, to avoid
--    forcing every invite flow to collect first/last name separately just
--    for this migration) -- the split now happens here instead of at read
--    time. Same first-space split rule as the backfill above.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_handle text;
  raw_name text;
  space_pos int;
  v_first_name text;
  v_last_name text;
begin
  new_handle := public.generate_unique_handle(new.email);

  raw_name := btrim(new.raw_user_meta_data ->> 'full_name');
  if raw_name is not null and raw_name <> '' then
    space_pos := position(' ' in raw_name);
    if space_pos > 0 then
      v_first_name := left(raw_name, space_pos - 1);
      v_last_name := nullif(btrim(substring(raw_name from space_pos + 1)), '');
    else
      v_first_name := raw_name;
      v_last_name := null;
    end if;
  else
    v_first_name := null;
    v_last_name := null;
  end if;

  insert into public.profiles (id, tenant_id, role, first_name, last_name, handle)
  values (new.id, null, 'member', v_first_name, v_last_name, new_handle);

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Always creates an inert profile (role=member, tenant_id=null) regardless of '
  'signup metadata -- privilege is assigned only by a trusted service-role UPDATE '
  'from POST /admin/clients or create-operator.ts, keyed by the auth.users id those '
  'trusted callers already control. See 2026-07-29 security review. '
  'tb-user-profile-name-split-001: raw_user_meta_data->>''full_name'' is split into '
  'first_name/last_name on the first space at insert time.';
