import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Live verification for 20260810230000_tier2_grant_lockdown.sql's three
// tables not already covered by an existing verify script:
// workspace_task_routing_settings, listing_share_events, notifications.
// Creates a disposable workspace + admin, signs in with only the
// publishable key, exercises the real legitimate write path on each table
// via direct PostgREST (proving the narrow re-grant didn't break it), then
// confirms a write to a column/table with no grant is rejected. Deletes
// everything it created.
// Run via: npx tsx src/scripts/verify-tier2-grant-lockdown.ts
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env first.');
    process.exit(1);
  }

  const suffix = Date.now();
  const email = `danielbacud+tier2-verify-${suffix}@gmail.com`;
  const password = 'Tier2GrantVerify123!';

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({ name: 'Tier 2 Grant Lockdown Verify', contract_start_date: '2026-01-01', contract_end_date: '2027-01-01' })
    .select('id')
    .single();
  if (workspaceError || !workspace) {
    console.error('workspace create failed:', workspaceError?.message);
    process.exit(1);
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (userError || !userData.user) {
    console.error('user create failed:', userError?.message);
    await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
    process.exit(1);
  }
  await supabaseAdmin.from('profiles').update({ tenant_id: workspace.id, role: 'admin' }).eq('id', userData.user.id);

  const { data: property } = await supabaseAdmin
    .from('properties')
    .insert({
      tenant_id: workspace.id,
      created_by: userData.user.id,
      title: 'Tier 2 Verify Unit',
      type: 'condo_unit',
      owner_type: 'individual',
      city: 'Taguig',
      province: 'Metro Manila',
      price: 1000000,
    })
    .select('id')
    .single();
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .insert({ tenant_id: workspace.id, property_id: property!.id, agent_id: userData.user.id, listing_type: 'sale', price: 1000000, status: 'active' })
    .select('id')
    .single();

  const results: { check: string; pass: boolean; detail: string }[] = [];

  try {
    const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const signIn = await anon.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data.session) throw new Error(`sign-in: ${signIn.error?.message}`);
    const scoped = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${signIn.data.session.access_token}` } },
    });

    // workspace_task_routing_settings: legitimate upsert (admin, has_settings_delegation('tasks') true for admin)
    const taskRouting = await scoped
      .from('workspace_task_routing_settings')
      .upsert({ tenant_id: workspace.id, task_type: 'viewing', default_assignee_id: null, assignee_role: 'admin' }, { onConflict: 'tenant_id,task_type' })
      .select('task_type, assignee_role');
    results.push({
      check: 'workspace_task_routing_settings legitimate upsert (should succeed)',
      pass: !taskRouting.error && (taskRouting.data?.length ?? 0) > 0,
      detail: taskRouting.error ? `${taskRouting.error.code}: ${taskRouting.error.message}` : JSON.stringify(taskRouting.data),
    });

    // listing_share_events: legitimate insert
    const shareEvent = await scoped
      .from('listing_share_events')
      .insert({ listing_id: listing!.id, tenant_id: workspace.id, audience: 'public', shared_by: userData.user.id })
      .select('id');
    results.push({
      check: 'listing_share_events legitimate insert (should succeed)',
      pass: !shareEvent.error && (shareEvent.data?.length ?? 0) > 0,
      detail: shareEvent.error ? `${shareEvent.error.code}: ${shareEvent.error.message}` : JSON.stringify(shareEvent.data),
    });
    // listing_share_events: UPDATE must now be rejected (append-only, no grant)
    const shareEventUpdate = await scoped.from('listing_share_events').update({ audience: 'internal' }).eq('id', shareEvent.data?.[0]?.id ?? '00000000-0000-0000-0000-000000000000');
    results.push({
      check: 'listing_share_events UPDATE (should be blocked, append-only)',
      pass: !!shareEventUpdate.error,
      detail: shareEventUpdate.error ? `${shareEventUpdate.error.code}: ${shareEventUpdate.error.message}` : 'no error -- UPDATE grant still present',
    });

    // notifications: no INSERT grant at all -- must be rejected
    const notifInsert = await scoped
      .from('notifications')
      .insert({ tenant_id: workspace.id, recipient_id: userData.user.id, type: 'test', title: 't', message: 'm' });
    results.push({
      check: 'notifications INSERT (should be blocked, no legitimate app insert path)',
      pass: !!notifInsert.error,
      detail: notifInsert.error ? `${notifInsert.error.code}: ${notifInsert.error.message}` : 'no error -- INSERT grant still present',
    });
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(userData.user.id);
    await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
  }

  let allPass = true;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} - ${r.check} (${r.detail})`);
    if (!r.pass) allPass = false;
  }
  console.log(allPass ? `\n${results.length}/${results.length} checks pass` : '\nSOME CHECKS FAILED');
  process.exit(allPass ? 0 : 1);
}

main();
