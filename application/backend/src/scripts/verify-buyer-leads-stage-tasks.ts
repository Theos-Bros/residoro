import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-buyer-leads-stage-tasks-001 DoD verification: stage-change task
// auto-generation across all 4 real stage-change code paths, role-based
// ('admin') and person-based default routing on workspace_task_routing_settings,
// and the "creation isn't a change" / "no-op PATCH creates no task" edge
// cases. Run via (from application/backend):
// npx tsx src/scripts/verify-buyer-leads-stage-tasks.ts
const EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL;
const PASSWORD = process.env.MOBILE_TEST_ACCOUNT_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;

async function main() {
  if (!EMAIL || !PASSWORD || !SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error('Set MOBILE_TEST_ACCOUNT_EMAIL/PASSWORD, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY in .env first.');
    process.exit(1);
  }

  const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signInError || !signIn.session) {
    console.error('Could not sign in as the test account:', signInError?.message);
    process.exit(1);
  }
  const token = signIn.session.access_token;
  const adminId = signIn.user!.id;
  console.log(`Signed in as ${EMAIL} (profile id ${adminId})`);

  const { data: profile } = await supabaseAdmin.from('profiles').select('tenant_id, role').eq('id', adminId).single();
  const tenantId = profile!.tenant_id;
  if (profile!.role !== 'admin') throw new Error('FAIL setup: test account is not admin -- cannot verify assignee_role resolution');
  console.log(`tenant_id=${tenantId} role=${profile!.role}`);

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

  async function tasksFor(entityId: string): Promise<any[]> {
    const res = await call(`/tasks?entity_type=buyer_requirement&entity_id=${entityId}`);
    if (res.status !== 200) throw new Error(`FAIL: could not load tasks for ${entityId}: ${JSON.stringify(res.body)}`);
    return res.body.tasks;
  }

  const routingTaskTypes = ['stage_viewing', 'stage_options_sent', 'stage_won', 'stage_searching'];
  let leadId: string | undefined;
  let leadId2: string | undefined;
  let contactId: string | undefined;
  let contactId2: string | undefined;
  let propertyId: string | undefined;
  let listingId: string | undefined;
  const createdTaskIds: string[] = [];

  try {
    console.log('\n--- Setup: property + active listing, two Leads ---');
    const propRes = await call('/properties', {
      method: 'POST',
      body: JSON.stringify({ title: 'Verify-Stage-Tasks Property', type: 'condo_unit', owner_type: 'individual' }),
    });
    if (propRes.status !== 201) throw new Error(`FAIL setup: property: ${JSON.stringify(propRes.body)}`);
    propertyId = propRes.body.id;

    const listingRes = await call('/listings', {
      method: 'POST',
      body: JSON.stringify({
        property_id: propertyId,
        listing_type: 'sale',
        price: 1000000,
        authority_starts_at: new Date().toISOString().slice(0, 10),
      }),
    });
    if (listingRes.status !== 201) throw new Error(`FAIL setup: listing: ${JSON.stringify(listingRes.body)}`);
    listingId = listingRes.body.id;
    const activateRes = await call(`/listings/${listingId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
    if (activateRes.status !== 200) throw new Error(`FAIL setup: activate listing: ${JSON.stringify(activateRes.body)}`);

    const leadRes = await call('/buyer-requirements', {
      method: 'POST',
      body: JSON.stringify({ create_contact: { name: 'Verify Stage Tasks Buyer 1' }, intent: 'buy' }),
    });
    if (leadRes.status !== 201) throw new Error(`FAIL setup: lead 1: ${JSON.stringify(leadRes.body)}`);
    leadId = leadRes.body.id;
    contactId = leadRes.body.contact_id;

    const leadRes2 = await call('/buyer-requirements', {
      method: 'POST',
      body: JSON.stringify({ create_contact: { name: 'Verify Stage Tasks Buyer 2' }, intent: 'buy' }),
    });
    if (leadRes2.status !== 201) throw new Error(`FAIL setup: lead 2: ${JSON.stringify(leadRes2.body)}`);
    leadId2 = leadRes2.body.id;
    contactId2 = leadRes2.body.contact_id;
    console.log(`property=${propertyId} listing=${listingId} lead1=${leadId} lead2=${leadId2}`);

    console.log('\n--- 1. POST /buyer-requirements (creation) does NOT create a stage-change task ---');
    const tasksAfterCreate = await tasksFor(leadId);
    if (tasksAfterCreate.length !== 0) throw new Error(`FAIL: creation should not create a task, found ${tasksAfterCreate.length}`);
    console.log('PASS');

    console.log("\n--- 2. Configure stage_viewing routing -> assignee_role='admin' ---");
    const setViewingRule = await call('/settings/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ task_type: 'stage_viewing', assignee_role: 'admin' }),
    });
    console.log(setViewingRule);
    if (setViewingRule.status !== 200) throw new Error('FAIL: could not set stage_viewing routing rule');
    if (setViewingRule.body.assignee_role !== 'admin' || setViewingRule.body.default_assignee_id !== null) {
      throw new Error('FAIL: stage_viewing rule should be assignee_role=admin, default_assignee_id=null');
    }
    console.log('PASS');

    console.log('\n--- 3. PATCH stage -> viewing creates a stage_viewing task assigned to the tenant admin ---');
    const toViewing = await call(`/buyer-requirements/${leadId}`, { method: 'PATCH', body: JSON.stringify({ stage: 'viewing' }) });
    if (toViewing.status !== 200) throw new Error(`FAIL: PATCH stage=viewing: ${JSON.stringify(toViewing.body)}`);
    await new Promise((r) => setTimeout(r, 300));
    let tasks = await tasksFor(leadId);
    const viewingTask = tasks.find((t) => t.task_type === 'stage_viewing');
    console.log(viewingTask);
    if (!viewingTask) throw new Error('FAIL: no stage_viewing task created');
    if (viewingTask.assignee_id !== adminId) throw new Error(`FAIL: expected assignee ${adminId}, got ${viewingTask.assignee_id}`);
    if (viewingTask.title !== 'Confirm viewing') throw new Error(`FAIL: unexpected title ${viewingTask.title}`);
    createdTaskIds.push(viewingTask.id);
    console.log('PASS');

    console.log('\n--- 4. A no-op PATCH (stage set to its current value) creates no additional task ---');
    const noOp = await call(`/buyer-requirements/${leadId}`, { method: 'PATCH', body: JSON.stringify({ stage: 'viewing' }) });
    if (noOp.status !== 200) throw new Error('FAIL: no-op PATCH should still 200');
    await new Promise((r) => setTimeout(r, 300));
    tasks = await tasksFor(leadId);
    const viewingTasks = tasks.filter((t) => t.task_type === 'stage_viewing');
    if (viewingTasks.length !== 1) throw new Error(`FAIL: expected exactly 1 stage_viewing task after no-op, found ${viewingTasks.length}`);
    console.log('PASS');

    console.log('\n--- 5. options-sent auto-advance with NO routing rule configured -> unassigned task, not an error ---');
    const optionsSent = await call(`/buyer-requirements/${leadId}/options-sent`, {
      method: 'POST',
      body: JSON.stringify({ listing_ids: [listingId] }),
    });
    console.log(optionsSent);
    if (optionsSent.status !== 201) throw new Error('FAIL: options-sent should 201');
    if (optionsSent.body.buyer_requirement.stage !== 'options_sent') throw new Error('FAIL: stage should be options_sent');
    await new Promise((r) => setTimeout(r, 300));
    tasks = await tasksFor(leadId);
    const optionsTask = tasks.find((t) => t.task_type === 'stage_options_sent');
    console.log(optionsTask);
    if (!optionsTask) throw new Error('FAIL: no stage_options_sent task created');
    if (optionsTask.assignee_id !== null) throw new Error('FAIL: stage_options_sent should be unassigned (no rule configured)');
    createdTaskIds.push(optionsTask.id);
    console.log('PASS');

    console.log("\n--- 6. Configure stage_won routing -> default_assignee_id (person case, unchanged tb-tasks-crud-001 behavior) ---");
    const setWonRule = await call('/settings/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ task_type: 'stage_won', default_assignee_id: adminId }),
    });
    if (setWonRule.status !== 200) throw new Error('FAIL: could not set stage_won routing rule');
    if (setWonRule.body.default_assignee_id !== adminId || setWonRule.body.assignee_role !== null) {
      throw new Error('FAIL: stage_won rule should be default_assignee_id=adminId, assignee_role=null');
    }
    console.log('PASS');

    console.log('\n--- 7. mark-won creates a stage_won task routed to the configured person ---');
    const markWon = await call(`/buyer-requirements/${leadId}/mark-won`, {
      method: 'PATCH',
      body: JSON.stringify({ listing_id: listingId }),
    });
    console.log(markWon);
    if (markWon.status !== 200) throw new Error(`FAIL: mark-won: ${JSON.stringify(markWon.body)}`);
    if (markWon.body.stage !== 'won') throw new Error('FAIL: stage should be won');
    await new Promise((r) => setTimeout(r, 300));
    tasks = await tasksFor(leadId);
    const wonTask = tasks.find((t) => t.task_type === 'stage_won');
    console.log(wonTask);
    if (!wonTask) throw new Error('FAIL: no stage_won task created');
    if (wonTask.assignee_id !== adminId) throw new Error('FAIL: stage_won task should be assigned to adminId');
    createdTaskIds.push(wonTask.id);
    console.log('PASS');

    console.log("\n--- 8. Configure stage_searching routing -> assignee_role='admin', trigger via the search auto-advance ---");
    const setSearchingRule = await call('/settings/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ task_type: 'stage_searching', assignee_role: 'admin' }),
    });
    if (setSearchingRule.status !== 200) throw new Error('FAIL: could not set stage_searching routing rule');
    console.log('PASS');

    console.log("\n--- 9. Search on a fresh (stage='registered') Lead auto-advances to searching + creates a task ---");
    const searchRes = await call(`/buyer-requirements/${leadId2}/search`, { method: 'POST', body: JSON.stringify({}) });
    console.log({ status: searchRes.status, resultCount: searchRes.body?.results?.length });
    if (searchRes.status !== 200) throw new Error(`FAIL: search: ${JSON.stringify(searchRes.body)}`);
    const leadAfterSearch = await call(`/buyer-requirements/${leadId2}`);
    if (leadAfterSearch.body.stage !== 'searching') throw new Error(`FAIL: expected stage=searching, got ${leadAfterSearch.body.stage}`);
    await new Promise((r) => setTimeout(r, 300));
    const tasks2 = await tasksFor(leadId2);
    const searchingTask = tasks2.find((t) => t.task_type === 'stage_searching');
    console.log(searchingTask);
    if (!searchingTask) throw new Error('FAIL: no stage_searching task created');
    if (searchingTask.assignee_id !== adminId) throw new Error('FAIL: stage_searching task should resolve to adminId via assignee_role');
    createdTaskIds.push(searchingTask.id);
    console.log('PASS');

    console.log('\n--- 10. PATCH /settings/tasks rejects both default_assignee_id and assignee_role given together ---');
    const bothGiven = await call('/settings/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ task_type: 'stage_viewing', default_assignee_id: adminId, assignee_role: 'admin' }),
    });
    console.log(bothGiven);
    if (bothGiven.status !== 400) throw new Error('FAIL: both fields given should 400');
    console.log('PASS');

    console.log("\n--- 11. PATCH /settings/tasks rejects an assignee_role other than 'admin' ---");
    const badRole = await call('/settings/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ task_type: 'stage_viewing', assignee_role: 'member' }),
    });
    console.log(badRole);
    if (badRole.status !== 400) throw new Error("FAIL: assignee_role='member' should 400");
    console.log('PASS');

    console.log('\nAll checks passed.');
  } finally {
    console.log('\n--- Cleanup ---');
    for (const id of createdTaskIds) await supabaseAdmin.from('tasks').delete().eq('id', id);
    await supabaseAdmin.from('workspace_task_routing_settings').delete().eq('tenant_id', tenantId).in('task_type', routingTaskTypes);
    if (leadId) await supabaseAdmin.from('buyer_requirement_matches').delete().eq('buyer_requirement_id', leadId);
    if (leadId) await supabaseAdmin.from('buyer_requirements').delete().eq('id', leadId);
    if (leadId2) await supabaseAdmin.from('buyer_requirements').delete().eq('id', leadId2);
    if (listingId) await supabaseAdmin.from('listings').delete().eq('id', listingId);
    if (propertyId) await supabaseAdmin.from('properties').delete().eq('id', propertyId);
    if (contactId) await supabaseAdmin.from('contacts').delete().eq('id', contactId);
    if (contactId2) await supabaseAdmin.from('contacts').delete().eq('id', contactId2);
    console.log('done');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
