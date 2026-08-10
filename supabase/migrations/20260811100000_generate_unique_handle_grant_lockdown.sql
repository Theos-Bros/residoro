-- Supabase security advisor (2026-08-11): generate_unique_handle(text) has never had an
-- explicit grant/revoke statement, so it sits on Postgres's implicit default PUBLIC EXECUTE
-- grant, callable directly and unauthenticated via /rest/v1/rpc/generate_unique_handle. It's
-- only ever meant to be called internally by handle_new_user() during signup; calling it
-- directly with an arbitrary email lets an anonymous caller infer whether a given email's
-- derived handle is already taken (a weak enumeration primitive). Revoking public execute does
-- not affect the trigger's own call, which runs as the function owner regardless of grants.

revoke execute on function public.generate_unique_handle(text) from public;
