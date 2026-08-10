-- Correction to 20260811100000: revoking from PUBLIC alone left anon/authenticated with
-- EXECUTE, because Supabase's schema setup grants EXECUTE on new public-schema functions to
-- anon/authenticated/service_role explicitly, independent of the generic PUBLIC grant -- the
-- same root-cause shape as the table-grant bug this repo already fixed (tb-platform-grant-
-- lockdown-001), just for functions. generate_unique_handle is only ever called internally by
-- handle_new_user() during signup (confirmed: no application code calls it via RPC), so neither
-- anon nor authenticated has any legitimate reason to execute it directly.

revoke execute on function public.generate_unique_handle(text) from anon;
revoke execute on function public.generate_unique_handle(text) from authenticated;
