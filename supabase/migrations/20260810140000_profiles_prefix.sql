-- ============================================================================
-- Migration: profiles -- self-service prefix field
-- Implements: tb-user-profile-email-prefix-001 (theos-registry)
--
-- Same column-level-grant shape as full_name's existing grant (see DD-001):
-- profiles_update_own's RLS policy already covers any column on the caller's
-- own row -- enforcement of *which* columns is the grant, not the policy, so
-- this needs no new RLS policy, only a new grant.
-- ============================================================================

alter table public.profiles add column prefix text;

comment on column public.profiles.prefix is
  'Free-text professional/courtesy title (e.g. "Atty.", "Broker") -- added by '
  'tb-user-profile-email-prefix-001. No fixed list, no format validation.';

grant update (prefix) on public.profiles to authenticated;
