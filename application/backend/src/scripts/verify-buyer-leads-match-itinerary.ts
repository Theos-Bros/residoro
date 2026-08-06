import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-buyer-leads-match-itinerary-001 DoD verification. Creates two throwaway
// workspaces (agent tenant A, sharer tenant B, mirroring
// verify-buyer-leads-matching.ts's docket-sharing setup) so all three item
// kinds a match log can hold are exercisable end-to-end: an own-inventory
// listing_id, a docket-shared (cross-tenant) listing_id, and a project-unit
// property_id. Also proves cross-tenant isolation on the new tables and that
// the itinerary route fails clearly (not silently) with no Google
// credentials configured, per the tracer bullet's explicit credential-gap
// constraint. Deletes everything it created.
// Run via (from application/backend, with `npx tsx src/index.ts` already
// running in another terminal):
// npx tsx src/scripts/verify-buyer-leads-match-itinerary.ts
const BACKEND_URL = process.env.BACKEND_VERIFY_URL ?? 'http://localhost:4000';
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

async function createWorkspaceAndUser(label: string, email: string, password: string, handle: string) {
  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({ name: `Match Itinerary Verify ${label}`, contract_start_date: '2026-01-01', contract_end_date: '2027-01-01' })
    .select('id')
    .single();
  if (workspaceError || !workspace) throw new Error(`workspace: ${workspaceError?.message}`);
  const tenantId = workspace.id as string;

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !userData.user) throw new Error(`user: ${userError?.message}`);
  const userId = userData.user.id as string;

  const { error: assignError } = await supabaseAdmin
    .from('profiles')
    .update({ tenant_id: tenantId, role: 'admin', handle })
    .eq('id', userId);
  if (assignError) throw new Error(`assign tenant/role/handle: ${assignError.message}`);

  return { tenantId, userId };
}

async function cleanup(tenantIds: string[], userIds: string[]) {
  for (const tenantId of tenantIds) {
    await supabaseAdmin.from('listing_dockets').delete().eq('source_tenant_id', tenantId);
    await supabaseAdmin.from('buyer_requirements').delete().eq('tenant_id', tenantId);
    await supabaseAdmin.from('listings').delete().eq('tenant_id', tenantId);
    await supabaseAdmin.from('properties').delete().eq('tenant_id', tenantId);
    await supabaseAdmin.from('projects').delete().eq('tenant_id', tenantId);
    await supabaseAdmin.from('contacts').delete().eq('tenant_id', tenantId);
    await supabaseAdmin.from('workspace_sharing_settings').delete().eq('tenant_id', tenantId);
    await supabaseAdmin.from('workspace_performance_settings').delete().eq('tenant_id', tenantId);
    await supabaseAdmin.from('workspace_matching_settings').delete().eq('tenant_id', tenantId);
    await supabaseAdmin.from('workspace_commission_settings').delete().eq('tenant_id', tenantId);
  }
  for (const id of userIds) await supabaseAdmin.auth.admin.deleteUser(id);
  for (const id of tenantIds) {
    const { error } = await supabaseAdmin.from('workspaces').delete().eq('id', id);
    if (error) console.error(`cleanup: workspace ${id} delete: ${error.message}`);
  }
}

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env first.');
    process.exit(1);
  }

  const suffix = Date.now();
  const agentEmail = `danielbacud+matchtb-agent-${suffix}@gmail.com`;
  const sharerEmail = `danielbacud+matchtb-sharer-${suffix}@gmail.com`;
  const password = 'MatchItineraryVerify123!';

  const agent = await createWorkspaceAndUser('Agent', agentEmail, password, `matchtbagent${suffix}`);
  const sharer = await createWorkspaceAndUser('Sharer', sharerEmail, password, `matchtbsharer${suffix}`);

  const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
  async function tokenFor(email: string): Promise<string> {
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new Error(`sign-in ${email}: ${error?.message}`);
    return data.session.access_token;
  }
  const agentToken = await tokenFor(agentEmail);
  const sharerToken = await tokenFor(sharerEmail);

  async function call(token: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    const body = await response.json().catch(() => undefined);
    return { status: response.status, body };
  }

  try {
    console.log('\n--- Setup: agent tenant owns an active listing + a project-linked (unlisted) unit ---');
    const agentProp = await call(agentToken, '/properties', {
      method: 'POST',
      body: JSON.stringify({ title: 'Agent Inventory Unit', type: 'condo_unit', owner_type: 'individual', city: 'Makati', province: 'Metro Manila', price: 3000000 }),
    });
    if (agentProp.status !== 201) throw new Error(`FAIL setup: agent property: ${JSON.stringify(agentProp.body)}`);
    const agentListing = await call(agentToken, '/listings', {
      method: 'POST',
      body: JSON.stringify({ property_id: agentProp.body.id, listing_type: 'sale', price: 3000000, authority_starts_at: '2026-01-01' }),
    });
    if (agentListing.status !== 201) throw new Error(`FAIL setup: agent listing: ${JSON.stringify(agentListing.body)}`);
    const agentListingId = agentListing.body.id as string;
    await call(agentToken, `/listings/${agentListingId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });

    const devRes = await call(agentToken, '/developers', { method: 'POST', body: JSON.stringify({ name: 'Verify Developer' }) });
    if (devRes.status !== 201) throw new Error(`FAIL setup: developer: ${JSON.stringify(devRes.body)}`);
    const projectRes = await call(agentToken, '/projects', {
      method: 'POST',
      body: JSON.stringify({ developer_id: devRes.body.id, name: 'Verify Project', project_type: 'condo' }),
    });
    if (projectRes.status !== 201) throw new Error(`FAIL setup: project: ${JSON.stringify(projectRes.body)}`);
    const unitRes = await call(agentToken, '/properties', {
      method: 'POST',
      body: JSON.stringify({ title: 'Unit 501', type: 'condo_unit', owner_type: 'developer', project_id: projectRes.body.id, city: 'Makati', province: 'Metro Manila', price: 3500000 }),
    });
    if (unitRes.status !== 201) throw new Error(`FAIL setup: project unit: ${JSON.stringify(unitRes.body)}`);
    const projectUnitId = unitRes.body.id as string;
    console.log(`agentListing=${agentListingId} projectUnit=${projectUnitId}`);

    console.log('\n--- Setup: sharer tenant shares an active listing via docket with the agent ---');
    const sharerProp = await call(sharerToken, '/properties', {
      method: 'POST',
      body: JSON.stringify({ title: 'Shared Docket Unit', type: 'condo_unit', owner_type: 'individual', city: 'Taguig', province: 'Metro Manila', price: 4000000 }),
    });
    if (sharerProp.status !== 201) throw new Error(`FAIL setup: sharer property: ${JSON.stringify(sharerProp.body)}`);
    const sharerListing = await call(sharerToken, '/listings', {
      method: 'POST',
      body: JSON.stringify({ property_id: sharerProp.body.id, listing_type: 'sale', price: 4000000, authority_starts_at: '2026-01-01' }),
    });
    if (sharerListing.status !== 201) throw new Error(`FAIL setup: sharer listing: ${JSON.stringify(sharerListing.body)}`);
    const sharerListingId = sharerListing.body.id as string;
    await call(sharerToken, `/listings/${sharerListingId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });

    const docketRes = await call(sharerToken, '/listing-dockets', {
      method: 'POST',
      body: JSON.stringify({ listing_id: sharerListingId, handle: `matchtbagent${suffix}`, included_fields: ['listing_type', 'status', 'type', 'city', 'province', 'price', 'price_currency', 'title'] }),
    });
    if (docketRes.status !== 201) throw new Error(`FAIL setup: docket: ${JSON.stringify(docketRes.body)}`);
    console.log(`sharerListing=${sharerListingId} docket=${docketRes.body.id}`);

    console.log('\n--- Setup: agent creates a Lead ---');
    const leadRes = await call(agentToken, '/buyer-requirements', {
      method: 'POST',
      body: JSON.stringify({ create_contact: { name: 'Match Itinerary Verify Buyer' }, intent: 'buy', property_type: 'condo_unit' }),
    });
    if (leadRes.status !== 201) throw new Error(`FAIL setup: lead: ${JSON.stringify(leadRes.body)}`);
    const leadId = leadRes.body.id as string;
    console.log(`lead=${leadId}`);

    const items = [{ listing_id: agentListingId }, { listing_id: sharerListingId }, { property_id: projectUnitId }];

    console.log('\n--- 1. POST match-logs: mixed inventory + docket listing + project-unit property, all in one log ---');
    const logRes = await call(agentToken, `/buyer-requirements/${leadId}/match-logs`, { method: 'POST', body: JSON.stringify({ items }) });
    if (logRes.status !== 201) throw new Error(`FAIL: log match: ${JSON.stringify(logRes.body)}`);
    const matchLog = logRes.body.match_log;
    if (matchLog.items.length !== 3) throw new Error(`FAIL: expected 3 items, got ${JSON.stringify(matchLog)}`);
    const sources = matchLog.items.map((i: any) => i.source).sort();
    if (JSON.stringify(sources) !== JSON.stringify(['docket', 'inventory', 'project_unit'])) {
      throw new Error(`FAIL: expected all 3 sources represented, got ${JSON.stringify(sources)}`);
    }
    console.log(`PASS (match_log=${matchLog.id}, items=${matchLog.items.map((i: any) => i.title).join(' | ')})`);

    console.log('\n--- 2. GET match-logs: history shows the logged entry with resolved titles + logged_by_handle ---');
    const historyRes = await call(agentToken, `/buyer-requirements/${leadId}/match-logs`);
    if (historyRes.status !== 200) throw new Error(`FAIL: get history: ${JSON.stringify(historyRes.body)}`);
    const entry = historyRes.body.match_logs.find((l: any) => l.id === matchLog.id);
    if (!entry) throw new Error(`FAIL: logged entry missing from history: ${JSON.stringify(historyRes.body)}`);
    if (entry.logged_by_handle !== `matchtbagent${suffix}`) throw new Error(`FAIL: expected logged_by_handle=matchtbagent${suffix}, got ${entry.logged_by_handle}`);
    if (entry.items.some((i: any) => i.title.includes('no longer available'))) {
      throw new Error(`FAIL: an item failed to resolve its display title: ${JSON.stringify(entry.items)}`);
    }
    console.log('PASS');

    console.log('\n--- 3. Cross-tenant isolation: sharer tenant cannot see agent tenant\'s match history (different tenant, different lead ownership) ---');
    const crossTenantRes = await call(sharerToken, `/buyer-requirements/${leadId}/match-logs`);
    if (crossTenantRes.status !== 404) throw new Error(`FAIL: expected 404 for cross-tenant lead access, got ${crossTenantRes.status}: ${JSON.stringify(crossTenantRes.body)}`);
    console.log('PASS (404 -- lead not found in sharer\'s workspace)');

    console.log('\n--- 3b. Cross-tenant isolation at the row level: sharer cannot log a match against agent\'s lead either ---');
    const crossTenantLogRes = await call(sharerToken, `/buyer-requirements/${leadId}/match-logs`, { method: 'POST', body: JSON.stringify({ items: [{ listing_id: sharerListingId }] }) });
    if (crossTenantLogRes.status !== 404) throw new Error(`FAIL: expected 404, got ${crossTenantLogRes.status}: ${JSON.stringify(crossTenantLogRes.body)}`);
    console.log('PASS (404)');

    console.log('\n--- 4. Validation: an item with both listing_id and property_id is rejected ---');
    const badShapeRes = await call(agentToken, `/buyer-requirements/${leadId}/match-logs`, { method: 'POST', body: JSON.stringify({ items: [{ listing_id: agentListingId, property_id: projectUnitId }] }) });
    if (badShapeRes.status !== 400) throw new Error(`FAIL: expected 400, got ${badShapeRes.status}: ${JSON.stringify(badShapeRes.body)}`);
    console.log('PASS (400)');

    console.log('\n--- 5. Validation: a listing_id belonging to neither the caller nor a shared docket is rejected ---');
    const foreignListingRes = await call(agentToken, `/buyer-requirements/${leadId}/match-logs`, { method: 'POST', body: JSON.stringify({ items: [{ listing_id: '00000000-0000-0000-0000-000000000000' }] }) });
    if (foreignListingRes.status !== 400) throw new Error(`FAIL: expected 400, got ${foreignListingRes.status}: ${JSON.stringify(foreignListingRes.body)}`);
    console.log('PASS (400)');

    console.log('\n--- 6. Copy as text: set a public share template, verify merge-field substitution across all 3 item kinds ---');
    const templatePatch = await call(agentToken, '/settings/share-templates', {
      method: 'PATCH',
      body: JSON.stringify({ public_share_template: '{{title}} -- {{price_currency}} {{price}} -- {{city}}' }),
    });
    if (templatePatch.status !== 200) throw new Error(`FAIL: set template: ${JSON.stringify(templatePatch.body)}`);
    const copyRes = await call(agentToken, `/buyer-requirements/${leadId}/match-copy-text`, { method: 'POST', body: JSON.stringify({ items }) });
    if (copyRes.status !== 200) throw new Error(`FAIL: copy-text: ${JSON.stringify(copyRes.body)}`);
    const text = copyRes.body.text as string;
    if (!text.includes('Agent Inventory Unit') || !text.includes('Shared Docket Unit') || !text.includes('Unit 501')) {
      throw new Error(`FAIL: expected all 3 titles in copy text, got: ${text}`);
    }
    if (!text.includes('3,000,000') || !text.includes('4,000,000')) {
      throw new Error(`FAIL: expected merge-field price substitution in copy text, got: ${text}`);
    }
    console.log(`PASS (text=\n${text}\n)`);

    console.log('\n--- 7. Generate itinerary: fails clearly (not silently) with no Google credentials configured ---');
    const itineraryRes = await call(agentToken, `/buyer-requirements/${leadId}/itinerary`, { method: 'POST', body: JSON.stringify({ items }) });
    if (itineraryRes.status !== 501) throw new Error(`FAIL: expected 501 (not configured), got ${itineraryRes.status}: ${JSON.stringify(itineraryRes.body)}`);
    if (!itineraryRes.body.error || !itineraryRes.body.error.includes('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS')) {
      throw new Error(`FAIL: expected a clear credential-gap error message, got: ${JSON.stringify(itineraryRes.body)}`);
    }
    console.log(`PASS (clear 501: ${itineraryRes.body.error})`);

    console.log('\n--- 8. Regression: buyer_requirement_matches / options-sent (the DIFFERENT, unrelated record type) is untouched ---');
    const optionsSentRes = await call(agentToken, `/buyer-requirements/${leadId}/options-sent`, {
      method: 'POST',
      body: JSON.stringify({ listing_ids: [agentListingId] }),
    });
    if (optionsSentRes.status !== 201) throw new Error(`FAIL: options-sent regressed: ${JSON.stringify(optionsSentRes.body)}`);
    const leadAfter = await call(agentToken, `/buyer-requirements/${leadId}`);
    if (!leadAfter.body.buyer_requirement_matches?.some((m: any) => m.listing_id === agentListingId)) {
      throw new Error('FAIL: options-sent match not found -- buyer_requirement_matches regressed');
    }
    if (leadAfter.body.stage !== 'options_sent') throw new Error(`FAIL: expected stage=options_sent, got ${leadAfter.body.stage}`);
    console.log('PASS (options-sent + buyer_requirement_matches still work exactly as before)');

    console.log('\n=== ALL DOD CHECKS PASSED ===');
  } finally {
    console.log('\n--- Cleanup ---');
    await supabaseAdmin.from('tasks').delete().in('tenant_id', [agent.tenantId, sharer.tenantId]);
    await cleanup([agent.tenantId, sharer.tenantId], [agent.userId, sharer.userId]);
    console.log('Cleaned up.');
  }
}

main().catch((err) => {
  console.error('\n=== VERIFICATION FAILED ===');
  console.error(err);
  process.exit(1);
});
