import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Live verification for 20260810180000_workspaces_grant_lockdown.sql
// (docs/security-review-2026-07-29.md Finding 7's deferred workspaces
// follow-up). Creates one disposable workspace + a real tenant admin, signs
// in as that admin with only the publishable key (no service-role, no
// backend API), and issues direct PostgREST calls against public.workspaces
// to confirm: (a) the table-wide UPDATE grant is gone -- writes to
// access_state/contract_end_date/exclusivity_hard_block/rollback_window_hours
// are rejected -- and (b) the legitimate read path (GET /me/workspace-status'
// select) still works. Deletes everything it created afterward.
// Run via: npx tsx src/scripts/verify-workspaces-grant-lockdown.ts
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env first.');
    process.exit(1);
  }

  const suffix = Date.now();
  const email = `danielbacud+workspaces-grant-verify-${suffix}@gmail.com`;
  const password = 'WorkspacesGrantVerify123!';

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({
      name: 'Workspaces Grant Lockdown Verify',
      contract_start_date: '2026-01-01',
      contract_end_date: '2027-01-01',
    })
    .select('id, access_state, contract_end_date, exclusivity_hard_block, rollback_window_hours')
    .single();
  if (workspaceError || !workspace) {
    console.error('workspace create failed:', workspaceError?.message);
    process.exit(1);
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !userData.user) {
    console.error('user create failed:', userError?.message);
    await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
    process.exit(1);
  }

  // Trigger leaves the profile inert (tenant_id null, role member) -- assign
  // real admin-of-own-tenant status the same trusted way admin.ts does.
  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({ tenant_id: workspace.id, role: 'admin' })
    .eq('id', userData.user.id);
  if (profileError) {
    console.error('profile assign failed:', profileError.message);
  }

  const results: { check: string; pass: boolean; detail: string }[] = [];

  try {
    const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const signIn = await anon.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data.session) throw new Error(`sign-in: ${signIn.error?.message}`);

    const scoped = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${signIn.data.session.access_token}` } },
    });

    // (a) legitimate read still works
    const readRes = await scoped
      .from('workspaces')
      .select('access_state, contract_end_date')
      .eq('id', workspace.id)
      .single();
    results.push({
      check: 'select (legitimate read path)',
      pass: !readRes.error && readRes.data?.access_state === 'active',
      detail: readRes.error ? readRes.error.message : JSON.stringify(readRes.data),
    });

    // (b)-(e) the four documented operator/system-only columns must now reject writes
    const writeAttempts: Array<[string, Record<string, unknown>]> = [
      ['access_state', { access_state: 'blocked' }],
      ['contract_end_date', { contract_end_date: '2099-01-01' }],
      ['exclusivity_hard_block', { exclusivity_hard_block: true }],
      ['rollback_window_hours', { rollback_window_hours: 999 }],
    ];
    for (const [label, payload] of writeAttempts) {
      const writeRes = await scoped.from('workspaces').update(payload).eq('id', workspace.id).select();
      const blocked = !!writeRes.error || (writeRes.data?.length ?? 0) === 0;
      results.push({
        check: `update ${label} (should be blocked)`,
        pass: blocked,
        detail: writeRes.error ? `${writeRes.error.code}: ${writeRes.error.message}` : `no error, rows returned: ${writeRes.data?.length}`,
      });
    }
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
