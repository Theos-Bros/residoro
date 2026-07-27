-- tb-brokerage-permissions-admin-uniqueness-001
-- Enforces at the database layer what application code already guarantees in practice:
-- exactly one 'admin'-role profile per tenant. cap-brokerage-permissions-001 Decision #3
-- relies on "owner" meaning "whoever holds admin" — this makes that reasoning permanent
-- instead of true by accident.
--
-- Partial (not full) unique index: profiles.tenant_id is not unique across all roles, only
-- 'admin' rows need the one-per-tenant guarantee. Postgres treats NULL tenant_id values as
-- distinct from each other in a unique index, so pre-existing admin-role rows with a NULL
-- tenant_id (orphaned test/debug profiles, confirmed harmless and out of this migration's
-- scope) do not block this index.

create unique index profiles_one_admin_per_tenant
  on public.profiles (tenant_id)
  where role = 'admin';
