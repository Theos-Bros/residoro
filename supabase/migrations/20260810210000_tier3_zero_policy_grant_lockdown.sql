-- ============================================================================
-- Migration: tb-platform-grant-lockdown-001, Tier 3 -- close the dangling
-- Supabase default table-wide grant on the six tables that have RLS enabled
-- but ZERO policies at all (contract_notifications, import_batches,
-- imported_contacts, imported_properties, migration_temp_files,
-- training_sessions).
--
-- Confirmed in docs/security-review-2026-07-29.md's Clean Findings section:
-- an RLS-enabled table with no policy for a given command default-denies
-- that command for every non-owner role, regardless of grants -- these six
-- were already correctly unreachable via authenticated/anon before this
-- migration. This is pure hygiene, not a live-exploit fix: same "one future
-- policy change away" latent-risk logic as the anon finding
-- (tb-platform-grant-lockdown-001's own Technical Design), applied here to
-- authenticated as well since neither role has ever had a legitimate reason
-- to touch these six tables directly -- every real access already goes
-- through supabaseAdmin (service_role), confirmed by grep: no
-- getScopedClient(...).from(<any of these six>) call exists anywhere in
-- application/backend/src.
-- ============================================================================

revoke all on public.contract_notifications from authenticated, anon;
revoke all on public.import_batches from authenticated, anon;
revoke all on public.imported_contacts from authenticated, anon;
revoke all on public.imported_properties from authenticated, anon;
revoke all on public.migration_temp_files from authenticated, anon;
revoke all on public.training_sessions from authenticated, anon;
