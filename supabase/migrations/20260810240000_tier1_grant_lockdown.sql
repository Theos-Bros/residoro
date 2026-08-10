-- ============================================================================
-- Migration: tb-platform-grant-lockdown-001, Tier 1 -- close the dangling
-- Supabase default table-wide grant on the 15 highest-risk tables: real
-- row-only tenant checks (no column restriction), same shape as
-- commission_earnings before its 2026-08-10 fix.
--
-- Every column list below verified by reading every real
-- getScopedClient(...).from(<table>) call across application/backend/src --
-- not inferred from the schema or migration history. Where a table's RLS
-- policy allows a command (e.g. DELETE) that no route actually uses, no
-- grant is given for it, matching the workspaces/commission_earnings
-- precedent (grant exactly what's used, not everything the policy would
-- technically allow).
--
-- FLAGGED, NOT FIXED HERE (out of this migration's scope -- a grant-layer
-- fix only, per tb-platform-grant-lockdown-001's semantic_scope): properties'
-- owner_type/owner_id columns have an APPLICATION-LAYER-ONLY admin check
-- (routes/listings.ts's PATCH /properties/:id: "Only an admin can change
-- property ownership", 403 for non-admins) that properties_update_tenant's
-- RLS policy does NOT mirror (tenant-only, no role check). Because the
-- legitimate admin flow needs these two columns grantable, this migration
-- cannot close that gap by narrowing the grant -- a non-admin tenant member
-- can still set owner_type/owner_id via a direct PostgREST call, bypassing
-- the app-layer 403. Real residual risk, needs an RLS policy change (a
-- column-level CHECK can't express "only if current_role() = admin"; would
-- need a trigger or a split policy), tracked in DD-002's correction note and
-- tb-platform-grant-lockdown-001's own What Happens Next.
-- ============================================================================

-- contracts
revoke all on public.contracts from authenticated, anon;
grant select on public.contracts to authenticated;
grant insert (tenant_id, buyer_requirement_id, listing_id, offer_id, agreed_price, currency, terms, created_by) on public.contracts to authenticated;
grant update (agreed_price, currency, terms, signing_status, signed_at) on public.contracts to authenticated;

-- closings
revoke all on public.closings from authenticated, anon;
grant select on public.closings to authenticated;
grant insert (tenant_id, contract_id, buyer_requirement_id, listing_id, final_price, currency, created_by) on public.closings to authenticated;
grant update (final_price, currency, checklist_state, completed_at) on public.closings to authenticated;

-- offers
revoke all on public.offers from authenticated, anon;
grant select on public.offers to authenticated;
grant insert (tenant_id, buyer_requirement_id, listing_id, offered_by, amount, currency, terms, supersedes_offer_id, created_by) on public.offers to authenticated;
grant update (status) on public.offers to authenticated;

-- listings (no DELETE grant -- no DELETE RLS policy exists on this table at all)
revoke all on public.listings from authenticated, anon;
grant select on public.listings to authenticated;
grant insert (tenant_id, property_id, agent_id, listing_type, price, price_currency, exclusivity, status, authority_starts_at, authority_expires_at) on public.listings to authenticated;
grant update (status, authority_starts_at, authority_expires_at, buyer_contact_id, listing_type, price, exclusivity) on public.listings to authenticated;

-- contacts
revoke all on public.contacts from authenticated, anon;
grant select on public.contacts to authenticated;
grant insert (tenant_id, created_by, name, type, is_company, email, phone, company, notes, address) on public.contacts to authenticated;
grant update (name, type, is_company, email, phone, company, notes) on public.contacts to authenticated;
grant delete on public.contacts to authenticated;

-- tasks
revoke all on public.tasks from authenticated, anon;
grant select on public.tasks to authenticated;
grant insert (tenant_id, created_by, title, description, due_date, task_type, entity_type, entity_id, assignee_id) on public.tasks to authenticated;
grant update (title, description, status, due_date, assignee_id, task_type) on public.tasks to authenticated;
grant delete on public.tasks to authenticated;

-- projects (no DELETE grant -- no delete route exists despite the admin-gated RLS policy)
revoke all on public.projects from authenticated, anon;
grant select on public.projects to authenticated;
grant insert (tenant_id, created_by, developer_id, name, project_type, location, total_units, status) on public.projects to authenticated;
grant update (name, project_type, location, total_units, status) on public.projects to authenticated;

-- properties -- see the flagged owner_type/owner_id note above
revoke all on public.properties from authenticated, anon;
grant select on public.properties to authenticated;
grant insert (tenant_id, created_by, title, type, owner_type, owner_id, project_id, address, city, province, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots, storeys, features, price, price_currency, unit_type_id, unit_number) on public.properties to authenticated;
grant update (title, address, city, province, price_currency, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots, storeys, price, features, status, lease_monthly_amount, lease_term_months, owner_type, owner_id, project_id, verification_status) on public.properties to authenticated;
grant delete on public.properties to authenticated;

-- viewings
revoke all on public.viewings from authenticated, anon;
grant select on public.viewings to authenticated;
grant insert (tenant_id, buyer_requirement_id, listing_id, scheduled_at, created_by) on public.viewings to authenticated;
grant update (outcome, feedback, scheduled_at) on public.viewings to authenticated;

-- property_media
revoke all on public.property_media from authenticated, anon;
grant select on public.property_media to authenticated;
grant insert (tenant_id, property_id, type, external_url, sort_order, is_cover, created_by) on public.property_media to authenticated;
grant update (sort_order, is_cover) on public.property_media to authenticated;
grant delete on public.property_media to authenticated;

-- property_documents (no UPDATE grant -- no UPDATE RLS policy exists on this table at all)
revoke all on public.property_documents from authenticated, anon;
grant select on public.property_documents to authenticated;
grant insert (tenant_id, property_id, document_type, storage_path, file_name, created_by) on public.property_documents to authenticated;
grant delete on public.property_documents to authenticated;

-- buyer_requirements (no DELETE grant -- no delete route exists despite the admin-gated RLS policy)
revoke all on public.buyer_requirements from authenticated, anon;
grant select on public.buyer_requirements to authenticated;
grant insert (tenant_id, created_by, contact_id, source_inquiry_id, stage, intent, property_type, budget_min, budget_max, budget_currency, target_city, target_province, floor_area_sqm_min, lot_area_sqm_min, storeys, bedrooms, bathrooms, household_adults, household_kids, household_pets, notes) on public.buyer_requirements to authenticated;
grant update (stage, won_listing_id, lease_end_date, last_searched_at, intent, property_type, budget_min, budget_max, budget_currency, target_city, target_province, floor_area_sqm_min, lot_area_sqm_min, storeys, bedrooms, bathrooms, household_adults, household_kids, household_pets, notes) on public.buyer_requirements to authenticated;

-- buyer_requirement_matches (no UPDATE/DELETE grant -- no route uses either, despite the DELETE RLS policy)
revoke all on public.buyer_requirement_matches from authenticated, anon;
grant select on public.buyer_requirement_matches to authenticated;
grant insert (tenant_id, buyer_requirement_id, listing_id, score, created_by) on public.buyer_requirement_matches to authenticated;

-- inquiries
revoke all on public.inquiries from authenticated, anon;
grant select on public.inquiries to authenticated;
grant insert (tenant_id, created_by, stage, buyer_name, buyer_phone, buyer_email, buyer_address, source, intent, property_type, budget_min, budget_max, budget_currency, target_city, target_province, floor_area_sqm_min, lot_area_sqm_min, storeys, bedrooms, bathrooms, household_adults, household_kids, household_pets, notes) on public.inquiries to authenticated;
grant update (stage, probed_by, buyer_name, buyer_phone, buyer_email, buyer_address, source, promoted_lead_id, archived_at, last_searched_at, intent, property_type, budget_min, budget_max, budget_currency, target_city, target_province, floor_area_sqm_min, lot_area_sqm_min, storeys, bedrooms, bathrooms, household_adults, household_kids, household_pets, notes) on public.inquiries to authenticated;
grant delete on public.inquiries to authenticated;

-- project_unit_types (no UPDATE/DELETE grant -- no route uses either, despite the admin-gated DELETE RLS policy)
revoke all on public.project_unit_types from authenticated, anon;
grant select on public.project_unit_types to authenticated;
grant insert (tenant_id, created_by, project_id, name, property_type, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots, storeys, features, price, price_currency, listing_type, exclusivity) on public.project_unit_types to authenticated;
