-- ============================================================================
-- tb-accounts-handle-001: Unique per-user @handle
--
-- Adds a unique, human-readable, admin-only-mutable `handle` column to
-- `profiles` -- the stable identifier tb-listings-co-broker-share-001 will
-- use to name a specific account to share with, independent of brokerage
-- affiliation. No in-app rename path exists by design (see the tracer
-- bullet doc); a platform admin edits `handle` directly in Supabase if it
-- ever needs to change.
--
-- Case-folding decision (left TBD in the tracer bullet doc, resolved here):
-- handles are stored and compared lowercase-only -- no separate display-case
-- column, since nothing yet needs anything but the raw value.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Handle generation helper
--    Derives a base handle from an email's local-part (stripping any
--    plus-alias suffix and non-alphanumeric characters), then appends a
--    numeric suffix on collision. security definer + empty search_path to
--    match handle_new_user()'s existing convention, since this is called
--    from inside that trigger.
-- ----------------------------------------------------------------------------
create or replace function public.generate_unique_handle(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  suffix int := 1;
begin
  base := lower(split_part(p_email, '@', 1));
  base := split_part(base, '+', 1);
  base := regexp_replace(base, '[^a-z0-9]', '', 'g');
  if base = '' then
    base := 'user';
  end if;

  candidate := base;
  while exists (select 1 from public.profiles where handle = candidate) loop
    suffix := suffix + 1;
    candidate := base || suffix::text;
  end loop;

  return candidate;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Add the column (nullable first) and backfill existing rows
--    Backfill processes in created_at order so the loop above resolves
--    collisions deterministically (earliest account keeps the clean handle).
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists handle text;

do $$
declare
  r record;
begin
  for r in
    select p.id, u.email
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.handle is null
    order by p.created_at
  loop
    update public.profiles
      set handle = public.generate_unique_handle(r.email)
      where id = r.id;
  end loop;
end;
$$;

alter table public.profiles
  alter column handle set not null,
  add constraint profiles_handle_unique unique (handle);

comment on column public.profiles.handle is
  'Unique, immutable-in-app identifier (tb-accounts-handle-001). Auto-assigned '
  'at account creation via handle_new_user(); no client-facing rename endpoint '
  'exists by design -- a platform admin edits this column directly in Supabase '
  'if it ever needs to change.';

-- ----------------------------------------------------------------------------
-- 3. Extend handle_new_user(): assign a handle on every insert branch
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_tenant_id uuid;
  invited_tenant_id uuid;
  new_handle text;
begin
  new_handle := public.generate_unique_handle(new.email);

  if new.raw_user_meta_data ->> 'app_role' = 'operator' then
    insert into public.profiles (id, tenant_id, role, full_name, handle)
    values (new.id, null, 'operator', new.raw_user_meta_data ->> 'full_name', new_handle);

    return new;
  end if;

  invited_tenant_id := (new.raw_user_meta_data ->> 'tenant_id')::uuid;
  if invited_tenant_id is not null then
    insert into public.profiles (id, tenant_id, role, full_name, handle)
    values (new.id, invited_tenant_id, 'admin', new.raw_user_meta_data ->> 'full_name', new_handle);

    return new;
  end if;

  -- Existing default behavior, unchanged: auto-create a workspace, signing-up
  -- user becomes its admin. This path is a placeholder for direct signup
  -- (DS-001) -- not the enrollment path, which always sets tenant_id above.
  insert into public.workspaces (name, contract_start_date, contract_end_date)
  values (
    coalesce(new.raw_user_meta_data ->> 'workspace_name', new.email || '''s Workspace'),
    current_date,
    current_date
  )
  returning id into new_tenant_id;

  insert into public.profiles (id, tenant_id, role, full_name, handle)
  values (
    new.id,
    new_tenant_id,
    'admin',
    new.raw_user_meta_data ->> 'full_name',
    new_handle
  );

  return new;
end;
$$;
