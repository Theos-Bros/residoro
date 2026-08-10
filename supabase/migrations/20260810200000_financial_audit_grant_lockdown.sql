-- ============================================================================
-- Migration: CRITICAL security fix -- close the same accidental table-wide
-- grant pattern as 20260810170000/20260810180000 (profiles/workspaces), on
-- the highest-blast-radius tables found by a follow-up security pass
-- (2026-08-10, prompted by "run a security check for anything we haven't
-- covered"): commission_earnings, billing_installments, contract_billing,
-- buyer_requirement_match_logs, buyer_requirement_match_log_items,
-- buyer_requirement_activity_log.
--
-- Same root cause: `authenticated` (and `anon`, never addressed by either
-- prior fix) held full table-wide INSERT/UPDATE/DELETE/TRUNCATE via
-- Supabase's un-revoked defaults. This pattern is confirmed present on 36 of
-- 38 public tables -- only profiles/workspaces were fixed so far. This
-- migration fixes the six highest-risk tables; the rest are scoped as a
-- follow-up tracer bullet, not fixed blind in this pass.
--
-- Evidence per table, from grepping every getScopedClient(...).from(...)
-- call in application/backend/src:
--
-- commission_earnings (routes/commission.ts): any tenant member may create
--   ONE commission_earnings row per closing (deliberately open, per that
--   route's own comment -- "a transactional record, same precedent as
--   offers/contracts/closings"). No UPDATE or DELETE route exists anywhere.
--   Before this fix: authenticated held a full UPDATE grant with no
--   protecting trigger, on a policy that only checks tenant_id -- any
--   member could PATCH total_commission/agent_amount/brokerage_amount on
--   ANY closing in their tenant directly via PostgREST (financial fraud),
--   or DELETE the record outright. Fix: revoke all, grant select + insert
--   on exactly the columns routes/commission.ts's .insert() call uses.
--
-- billing_installments, contract_billing (routes/admin.ts): every write
--   goes through supabaseAdmin (service_role) behind requireOperator --
--   zero legitimate authenticated-role write usage. Both already have only
--   an admin-scoped SELECT policy (billing_installments_select_admin /
--   contract_billing_select_admin), no INSERT/UPDATE/DELETE policy at all,
--   so RLS was already default-denying writes -- this closes the dangling
--   grant for defense in depth (same "unreachable today, one policy change
--   away from live" logic as the anon finding below), matching workspaces'
--   "no write grant re-added at all" precedent.
--
-- buyer_requirement_match_logs / buyer_requirement_match_log_items
--   (routes/matchLogs.ts), buyer_requirement_activity_log
--   (routes/leadActivityLog.ts): append-only audit logs, insert-only from
--   the backend, both routes set `logged_by: request.user!.id` themselves.
--   Before this fix: authenticated held full UPDATE/DELETE grants despite
--   no UPDATE/DELETE policy existing (harmless -- RLS already blocks those
--   commands), but the INSERT policy's WITH CHECK only verified tenant_id,
--   never logged_by -- a direct PostgREST insert could set logged_by to
--   ANY uuid in the tenant, forging an audit-trail entry attributed to a
--   colleague. This migration closes both the grant AND the WITH CHECK gap.
--
-- `anon` gets `revoke all` and nothing back on all six tables -- no
-- legitimate anon usage exists anywhere in this schema (see the broader
-- anon finding from this same review pass, scoped separately).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- commission_earnings
-- ---------------------------------------------------------------------------
revoke all on public.commission_earnings from authenticated, anon;

grant select on public.commission_earnings to authenticated;
grant insert (
  tenant_id, closing_id, total_commission, currency,
  brokerage_pct, agent_pct, co_broker_pct,
  brokerage_amount, agent_amount, co_broker_amount, created_by
) on public.commission_earnings to authenticated;

-- ---------------------------------------------------------------------------
-- billing_installments / contract_billing -- select only, RLS already
-- restricts SELECT to same-tenant admins; every write is supabaseAdmin-only
-- ---------------------------------------------------------------------------
revoke all on public.billing_installments from authenticated, anon;
grant select on public.billing_installments to authenticated;

revoke all on public.contract_billing from authenticated, anon;
grant select on public.contract_billing to authenticated;

-- ---------------------------------------------------------------------------
-- buyer_requirement_match_logs + items -- select/insert only, append-only
-- ---------------------------------------------------------------------------
revoke all on public.buyer_requirement_match_logs from authenticated, anon;
grant select on public.buyer_requirement_match_logs to authenticated;
grant insert (tenant_id, buyer_requirement_id, logged_by)
  on public.buyer_requirement_match_logs to authenticated;

revoke all on public.buyer_requirement_match_log_items from authenticated, anon;
grant select on public.buyer_requirement_match_log_items to authenticated;
grant insert (match_log_id, listing_id, property_id)
  on public.buyer_requirement_match_log_items to authenticated;

-- Close the logged_by-spoofing gap: WITH CHECK never verified the inserting
-- user is who they claim to be logging as.
alter policy brml_insert_tenant on public.buyer_requirement_match_logs
  with check (
    tenant_id = (select current_tenant_id())
    and logged_by = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- buyer_requirement_activity_log -- select/insert only, append-only
-- ---------------------------------------------------------------------------
revoke all on public.buyer_requirement_activity_log from authenticated, anon;
grant select on public.buyer_requirement_activity_log to authenticated;
grant insert (tenant_id, buyer_requirement_id, activity_type, notes, occurred_at, logged_by)
  on public.buyer_requirement_activity_log to authenticated;

alter policy bral_insert_tenant on public.buyer_requirement_activity_log
  with check (
    tenant_id = (select current_tenant_id())
    and logged_by = (select auth.uid())
  );
