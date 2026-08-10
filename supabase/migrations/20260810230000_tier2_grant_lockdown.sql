-- ============================================================================
-- Migration: tb-platform-grant-lockdown-001, Tier 2 -- close the dangling
-- Supabase default table-wide grant on the 10 tables whose RLS policies are
-- already role/delegation/self-scoped (narrower than Tier 1's tenant-only
-- checks, but the grant behind them was still the un-revoked default).
--
-- Column choices below verified by reading every real
-- getScopedClient(...).from(<table>) call in application/backend/src:
--
-- settings_edit_delegations: select (any tenant member, read-only visibility
--   of who has what) + insert/update/delete on exactly the four columns
--   routes/settingsPermissions.ts's upsert/delete use. The table's own
--   insert/update/delete RLS policies are admin-gated already
--   (current_role() = 'admin') -- this migration only narrows the grant
--   sitting alongside that check, doesn't change it.
-- workspace_commission_settings / _itinerary_settings / _matching_settings /
--   _performance_settings / _sharing_settings: select (tenant-wide) +
--   update on exactly the settings columns each route
--   (commission.ts/itinerarySettings.ts/matching.ts/analytics.ts/
--   shareText.ts) actually writes. No insert/delete grant -- DD-014
--   confirms rows are provisioned solely by the workspaces insert trigger,
--   verified: no getScopedClient insert/delete call exists on any of these
--   five tables.
-- workspace_task_routing_settings: select + insert/update on exactly the
--   four columns routes/tasks.ts's upsert uses (its RLS uses a single ALL
--   policy for insert/update/delete, delegation-gated -- no delete call
--   exists in the backend, so no delete grant either).
-- listing_dockets: select (participant) + insert on exactly the five
--   columns routes/dockets.ts's create-docket insert uses + update(status)
--   only (routes/dockets.ts's revoke-docket call, the only UPDATE anywhere
--   on this table). No delete grant -- no DELETE RLS policy exists either,
--   matching that there's no delete route.
-- listing_share_events: select (tenant) + insert on exactly the four
--   columns routes/analytics.ts's insert uses. No update/delete grant --
--   append-only event log, no RLS policy for either command exists.
-- notifications: select (own-or-tenant-wide) + update(dismissed_at) only.
--   No insert grant -- confirmed no getScopedClient(...).from('notifications')
--   insert call exists anywhere in application/backend/src; rows are created
--   exclusively by the task-due-reminder-check Edge Function via
--   service_role (supabase/functions/task-due-reminder-check/index.ts),
--   unaffected by this revoke. No RLS INSERT policy exists either, matching.
-- ============================================================================

-- settings_edit_delegations
revoke all on public.settings_edit_delegations from authenticated, anon;
grant select on public.settings_edit_delegations to authenticated;
grant insert (tenant_id, member_id, setting_key, granted_by) on public.settings_edit_delegations to authenticated;
grant update (tenant_id, member_id, setting_key, granted_by) on public.settings_edit_delegations to authenticated;
grant delete on public.settings_edit_delegations to authenticated;

-- workspace_commission_settings
revoke all on public.workspace_commission_settings from authenticated, anon;
grant select on public.workspace_commission_settings to authenticated;
grant update (default_brokerage_pct, default_agent_pct, default_co_broker_pct) on public.workspace_commission_settings to authenticated;

-- workspace_itinerary_settings
revoke all on public.workspace_itinerary_settings from authenticated, anon;
grant select on public.workspace_itinerary_settings to authenticated;
grant update (recipient_email, drive_folder_id, template_document_id) on public.workspace_itinerary_settings to authenticated;

-- workspace_matching_settings
revoke all on public.workspace_matching_settings from authenticated, anon;
grant select on public.workspace_matching_settings to authenticated;
grant update (match_score_threshold) on public.workspace_matching_settings to authenticated;

-- workspace_performance_settings
revoke all on public.workspace_performance_settings from authenticated, anon;
grant select on public.workspace_performance_settings to authenticated;
grant update (hot_share_threshold) on public.workspace_performance_settings to authenticated;

-- workspace_sharing_settings
revoke all on public.workspace_sharing_settings from authenticated, anon;
grant select on public.workspace_sharing_settings to authenticated;
grant update (public_share_template, co_broker_share_template, buyer_wanted_share_template) on public.workspace_sharing_settings to authenticated;

-- workspace_task_routing_settings
revoke all on public.workspace_task_routing_settings from authenticated, anon;
grant select on public.workspace_task_routing_settings to authenticated;
grant insert (tenant_id, task_type, default_assignee_id, assignee_role) on public.workspace_task_routing_settings to authenticated;
grant update (tenant_id, task_type, default_assignee_id, assignee_role) on public.workspace_task_routing_settings to authenticated;

-- listing_dockets
revoke all on public.listing_dockets from authenticated, anon;
grant select on public.listing_dockets to authenticated;
grant insert (source_listing_id, source_tenant_id, shared_by, shared_with, included_fields) on public.listing_dockets to authenticated;
grant update (status) on public.listing_dockets to authenticated;

-- listing_share_events
revoke all on public.listing_share_events from authenticated, anon;
grant select on public.listing_share_events to authenticated;
grant insert (listing_id, tenant_id, audience, shared_by) on public.listing_share_events to authenticated;

-- notifications
revoke all on public.notifications from authenticated, anon;
grant select on public.notifications to authenticated;
grant update (dismissed_at) on public.notifications to authenticated;
