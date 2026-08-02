import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-buyer-leads-matching-project-units-001 DoD verification. Creates one
// throwaway workspace/user, a developer + project, and several project-linked
// properties in different statuses, to prove scoreProjectUnits() only
// surfaces available, project_id-linked properties on buy-intent searches.
// Mirrors verify-buyer-leads-matching.ts's pattern. Deletes everything it
// created.
// Run via (from application/backend, with `npx tsx src/index.ts` already
// running in another terminal):
// npx tsx src/scripts/verify-buyer-leads-matching-project-units.ts
const BACKEND_URL = process.env.BACKEND_VERIFY_URL ?? 'http://localhost:4000';
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env first.');
    process.exit(1);
  }

  const suffix = Date.now();
  const email = `danielbacud+matching-project-units-${suffix}@gmail.com`;
  const password = 'MatchingProjUnitsVerify123!';

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({ name: `Matching Project Units Verify ${suffix}`, contract_start_date: '2026-01-01', contract_end_date: '2027-01-01' })
    .select('id')
    .single();
  if (workspaceError || !workspace) throw new Error(`workspace: ${workspaceError?.message}`);
  const tenantId = workspace.id as string;

  // 2026-07-29 security review: handle_new_user() no longer honors any
  // tenant_id/app_role passed through user_metadata (that was the signup
  // privilege-escalation hole) -- it always creates an inert
  // role='member'/tenant_id=null profile. The real assignment has to happen
  // right after, via a service-role UPDATE keyed by the trusted new user id
  // (same pattern as create-operator.ts).
  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !userData.user) throw new Error(`user: ${userError?.message}`);
  const userId = userData.user.id as string;

  const { error: assignError } = await supabaseAdmin
    .from('profiles')
    .update({ tenant_id: tenantId, role: 'admin' })
    .eq('id', userId);
  if (assignError) throw new Error(`assign tenant/role: ${assignError.message}`);

  const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
  const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError || !signInData.session) throw new Error(`sign-in: ${signInError?.message}`);
  const token = signInData.session.access_token;

  async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
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

  let propertyIds: string[] = [];

  try {
    console.log('\n--- Setup: developer + project ---');
    const devRes = await call('/developers', { method: 'POST', body: JSON.stringify({ name: 'Verify Developer' }) });
    if (devRes.status !== 201) throw new Error(`FAIL setup: developer: ${JSON.stringify(devRes.body)}`);
    const developerId = devRes.body.id;

    const projectRes = await call('/projects', {
      method: 'POST',
      body: JSON.stringify({ developer_id: developerId, name: 'Verify Project', project_type: 'condo' }),
    });
    if (projectRes.status !== 201) throw new Error(`FAIL setup: project: ${JSON.stringify(projectRes.body)}`);
    const projectId = projectRes.body.id;
    console.log(`developer=${developerId} project=${projectId}`);

    console.log('\n--- Setup: 5 project-linked properties, one per status (available/reserved/sold/off_market/leased) ---');
    const statuses = ['available', 'reserved', 'sold', 'off_market', 'leased'] as const;
    const propByStatus: Record<string, string> = {};
    for (const status of statuses) {
      const propRes = await call('/properties', {
        method: 'POST',
        body: JSON.stringify({
          title: `Unit ${status}`,
          type: 'condo_unit',
          owner_type: 'developer',
          project_id: projectId,
          city: 'Makati',
          province: 'Metro Manila',
          bedrooms: 2,
          bathrooms: 2,
          price: 3000000,
        }),
      });
      if (propRes.status !== 201) throw new Error(`FAIL setup: property ${status}: ${JSON.stringify(propRes.body)}`);
      propertyIds.push(propRes.body.id);
      propByStatus[status] = propRes.body.id;

      if (status !== 'available') {
        const patchBody: Record<string, unknown> = { status };
        if (status === 'leased') {
          patchBody.lease_monthly_rent = 30000;
          patchBody.lease_term_months = 12;
        }
        const patchRes = await call(`/properties/${propRes.body.id}`, { method: 'PATCH', body: JSON.stringify(patchBody) });
        if (patchRes.status !== 200) throw new Error(`FAIL setup: set status ${status}: ${JSON.stringify(patchRes.body)}`);
      }
    }
    console.log(`properties by status: ${JSON.stringify(propByStatus)}`);

    console.log('\n--- Setup: a non-project-linked property (no project_id), same tenant, available ---');
    const standaloneRes = await call('/properties', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Standalone Unit',
        type: 'condo_unit',
        owner_type: 'individual',
        city: 'Makati',
        province: 'Metro Manila',
        bedrooms: 2,
        bathrooms: 2,
        price: 3000000,
      }),
    });
    if (standaloneRes.status !== 201) throw new Error(`FAIL setup: standalone property: ${JSON.stringify(standaloneRes.body)}`);
    propertyIds.push(standaloneRes.body.id);
    const standaloneId = standaloneRes.body.id;

    console.log('\n--- 1. Buy-intent ad-hoc search returns the available project unit, scored, tagged project_unit ---');
    const buySearch = await call('/search', {
      method: 'POST',
      body: JSON.stringify({
        requirement: { intent: 'buy', property_type: 'condo_unit', target_city: 'Makati', budget_min: 2000000, budget_max: 4000000, bedrooms: 2, bathrooms: 2 },
        hard_filter_fields: [],
      }),
    });
    if (buySearch.status !== 200) throw new Error(`FAIL: buy search: ${JSON.stringify(buySearch.body)}`);
    const buyResults = buySearch.body.results as any[];
    const projectUnitResult = buyResults.find((r) => r.listing_id === propByStatus.available);
    if (!projectUnitResult) throw new Error(`FAIL: available project unit missing from buy-intent search: ${JSON.stringify(buyResults)}`);
    if (projectUnitResult.source !== 'project_unit') throw new Error(`FAIL: expected source=project_unit, got ${projectUnitResult.source}`);
    if (!projectUnitResult.property_title.includes('Verify Project')) {
      throw new Error(`FAIL: expected property_title to include project name, got ${projectUnitResult.property_title}`);
    }
    if (typeof projectUnitResult.score !== 'number') throw new Error('FAIL: expected a numeric score');
    console.log(`PASS (title=${projectUnitResult.property_title} score=${projectUnitResult.score} matched=${projectUnitResult.matched_fields})`);

    console.log('\n--- 2. Lease-intent search never returns any project_unit-sourced result ---');
    const leaseSearch = await call('/search', {
      method: 'POST',
      body: JSON.stringify({ requirement: { intent: 'lease', property_type: 'condo_unit' }, hard_filter_fields: [] }),
    });
    if (leaseSearch.status !== 200) throw new Error(`FAIL: lease search: ${JSON.stringify(leaseSearch.body)}`);
    const leaseResults = leaseSearch.body.results as any[];
    if (leaseResults.some((r) => r.source === 'project_unit')) {
      throw new Error(`FAIL: lease-intent search returned a project_unit result: ${JSON.stringify(leaseResults)}`);
    }
    console.log('PASS (no project_unit results for lease intent)');

    console.log('\n--- 3. reserved/sold/off_market/leased project units never appear (buy-intent search) ---');
    const nonAvailableIds = [propByStatus.reserved, propByStatus.sold, propByStatus.off_market, propByStatus.leased];
    const leaked = buyResults.filter((r) => nonAvailableIds.includes(r.listing_id));
    if (leaked.length > 0) throw new Error(`FAIL: non-available project units leaked into search: ${JSON.stringify(leaked)}`);
    console.log('PASS (reserved/sold/off_market/leased all excluded)');

    console.log('\n--- 4. A property with no project_id never appears via the project_unit source ---');
    const standaloneAsProjectUnit = buyResults.find((r) => r.listing_id === standaloneId && r.source === 'project_unit');
    if (standaloneAsProjectUnit) throw new Error('FAIL: standalone (no project_id) property appeared as a project_unit result');
    console.log('PASS (standalone property not surfaced via project_unit source)');

    console.log('\n--- 5. /buyer-requirements/:id/search also includes project_unit results for a buy lead ---');
    const leadRes = await call('/buyer-requirements', {
      method: 'POST',
      body: JSON.stringify({
        create_contact: { name: 'Project Units Verify Buyer' },
        intent: 'buy',
        property_type: 'condo_unit',
        target_city: 'Makati',
        budget_min: 2000000,
        budget_max: 4000000,
      }),
    });
    if (leadRes.status !== 201) throw new Error(`FAIL: create lead: ${JSON.stringify(leadRes.body)}`);
    const leadId = leadRes.body.id;
    const leadSearch = await call(`/buyer-requirements/${leadId}/search`, { method: 'POST', body: JSON.stringify({ hard_filter_fields: [] }) });
    if (leadSearch.status !== 200) throw new Error(`FAIL: lead search: ${JSON.stringify(leadSearch.body)}`);
    const leadResults = leadSearch.body.results as any[];
    if (!leadResults.some((r) => r.listing_id === propByStatus.available && r.source === 'project_unit')) {
      throw new Error(`FAIL: buyer-requirements search missing project_unit result: ${JSON.stringify(leadResults)}`);
    }
    console.log('PASS (buyer-requirements/:id/search includes project_unit result)');

    console.log('\n--- 6. options-sent still rejects a project-unit id (no real listing_id to attach) ---');
    const sendRes = await call(`/buyer-requirements/${leadId}/options-sent`, {
      method: 'POST',
      body: JSON.stringify({ listing_ids: [propByStatus.available], scores: { [propByStatus.available]: projectUnitResult.score } }),
    });
    if (sendRes.status === 201) {
      throw new Error(`FAIL: expected options-sent to reject a property (non-listing) id, but it succeeded: ${JSON.stringify(sendRes.body)}`);
    }
    console.log(`PASS (options-sent rejected project-unit id with status ${sendRes.status}: ${JSON.stringify(sendRes.body)})`);

    console.log('\n=== ALL DOD CHECKS PASSED ===');
  } finally {
    console.log('\n--- Cleanup ---');
    // FK order matters: buyer_requirements (cascades its own matches) before
    // properties/projects before contacts (developer_id/owner_id both point
    // at contacts, per tb-crm-developer-consolidation-001's folding of the
    // old `developers` table into `contacts` with is_company=true) before
    // the workspace itself.
    // tb-buyer-leads-stage-tasks-001: step 5's buyer-requirements search
    // bumps the lead registered -> searching, which fires a stage-change
    // task -- has to go before buyer_requirements (tasks references it) and
    // before the workspace.
    await supabaseAdmin.from('tasks').delete().eq('tenant_id', tenantId);
    await supabaseAdmin.from('buyer_requirements').delete().eq('tenant_id', tenantId);
    for (const id of propertyIds) {
      await supabaseAdmin.from('properties').delete().eq('id', id);
    }
    await supabaseAdmin.from('projects').delete().eq('tenant_id', tenantId);
    await supabaseAdmin.from('contacts').delete().eq('tenant_id', tenantId);
    // 20260728171500_workspace_settings_defaults_trigger.sql auto-provisions
    // one row per tenant in each of these on workspace insert -- no cascade,
    // so they have to go before the workspace itself.
    await supabaseAdmin.from('workspace_sharing_settings').delete().eq('tenant_id', tenantId);
    await supabaseAdmin.from('workspace_performance_settings').delete().eq('tenant_id', tenantId);
    await supabaseAdmin.from('workspace_matching_settings').delete().eq('tenant_id', tenantId);
    await supabaseAdmin.auth.admin.deleteUser(userId);
    const { error: workspaceDeleteError } = await supabaseAdmin.from('workspaces').delete().eq('id', tenantId);
    if (workspaceDeleteError) throw new Error(`cleanup: workspace delete: ${workspaceDeleteError.message}`);
    console.log('Cleaned up.');
  }
}

main().catch((err) => {
  console.error('\n=== VERIFICATION FAILED ===');
  console.error(err);
  process.exit(1);
});
