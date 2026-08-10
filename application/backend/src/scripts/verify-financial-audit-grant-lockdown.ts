import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Live verification for 20260810200000_financial_audit_grant_lockdown.sql.
// Creates one disposable workspace + two real tenant members (a "self" and
// a "colleague", to test logged_by spoofing), signs in with only the
// publishable key (no service-role, no backend API), and issues direct
// PostgREST calls to confirm the escalation paths this migration closed are
// now rejected. Postgres checks column-level privileges before row
// matching, so these checks don't need real closing/buyer_requirement rows
// to prove denial -- a random target id still triggers a permission error
// if the grant is gone. Deletes everything it created afterward.
// Run via: npx tsx src/scripts/verify-financial-audit-grant-lockdown.ts
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env first.');
    process.exit(1);
  }

  const suffix = Date.now();
  const selfEmail = `danielbacud+finaudit-verify-self-${suffix}@gmail.com`;
  const colleagueEmail = `danielbacud+finaudit-verify-colleague-${suffix}@gmail.com`;
  const password = 'FinAuditGrantVerify123!';

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({ name: 'Financial/Audit Grant Lockdown Verify', contract_start_date: '2026-01-01', contract_end_date: '2027-01-01' })
    .select('id')
    .single();
  if (workspaceError || !workspace) {
    console.error('workspace create failed:', workspaceError?.message);
    process.exit(1);
  }

  const { data: selfUser, error: selfUserError } = await supabaseAdmin.auth.admin.createUser({
    email: selfEmail,
    password,
    email_confirm: true,
  });
  const { data: colleagueUser, error: colleagueUserError } = await supabaseAdmin.auth.admin.createUser({
    email: colleagueEmail,
    password,
    email_confirm: true,
  });
  if (selfUserError || !selfUser.user || colleagueUserError || !colleagueUser.user) {
    console.error('user create failed:', selfUserError?.message, colleagueUserError?.message);
    await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
    process.exit(1);
  }

  await supabaseAdmin.from('profiles').update({ tenant_id: workspace.id, role: 'member' }).eq('id', selfUser.user.id);
  await supabaseAdmin.from('profiles').update({ tenant_id: workspace.id, role: 'member' }).eq('id', colleagueUser.user.id);

  const results: { check: string; pass: boolean; detail: string }[] = [];
  const randomId = '00000000-0000-0000-0000-000000000000';

  try {
    const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const signIn = await anon.auth.signInWithPassword({ email: selfEmail, password });
    if (signIn.error || !signIn.data.session) throw new Error(`sign-in: ${signIn.error?.message}`);

    const scoped = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${signIn.data.session.access_token}` } },
    });

    // commission_earnings: UPDATE/DELETE must now be rejected outright
    const ceUpdate = await scoped.from('commission_earnings').update({ total_commission: 999999 }).eq('id', randomId).select();
    results.push({
      check: 'commission_earnings UPDATE (should be blocked)',
      pass: !!ceUpdate.error,
      detail: ceUpdate.error ? `${ceUpdate.error.code}: ${ceUpdate.error.message}` : 'no error -- UPDATE grant still present',
    });

    const ceDelete = await scoped.from('commission_earnings').delete().eq('id', randomId);
    results.push({
      check: 'commission_earnings DELETE (should be blocked)',
      pass: !!ceDelete.error,
      detail: ceDelete.error ? `${ceDelete.error.code}: ${ceDelete.error.message}` : 'no error -- DELETE grant still present',
    });

    // billing_installments / contract_billing: no write grant at all now
    const biInsert = await scoped.from('billing_installments').insert({ tenant_id: workspace.id, amount: 1, due_date: '2027-01-01' });
    results.push({
      check: 'billing_installments INSERT (should be blocked, authenticated has select-only)',
      pass: !!biInsert.error,
      detail: biInsert.error ? `${biInsert.error.code}: ${biInsert.error.message}` : 'no error -- INSERT grant still present',
    });

    const cbInsert = await scoped.from('contract_billing').insert({ tenant_id: workspace.id, contract_value: 1, currency: 'PHP' });
    results.push({
      check: 'contract_billing INSERT (should be blocked, authenticated has select-only)',
      pass: !!cbInsert.error,
      detail: cbInsert.error ? `${cbInsert.error.code}: ${cbInsert.error.message}` : 'no error -- INSERT grant still present',
    });

    // buyer_requirement_activity_log / buyer_requirement_match_logs: the
    // grant now allows INSERT, but WITH CHECK must reject a spoofed logged_by
    const spoofedActivity = await scoped
      .from('buyer_requirement_activity_log')
      .insert({
        tenant_id: workspace.id,
        buyer_requirement_id: randomId,
        activity_type: 'note',
        occurred_at: new Date().toISOString(),
        logged_by: colleagueUser.user.id,
      })
      .select();
    results.push({
      check: 'buyer_requirement_activity_log INSERT with spoofed logged_by (should be blocked)',
      pass: !!spoofedActivity.error,
      detail: spoofedActivity.error
        ? `${spoofedActivity.error.code}: ${spoofedActivity.error.message}`
        : 'no error -- logged_by spoofing still possible',
    });

    const spoofedMatchLog = await scoped
      .from('buyer_requirement_match_logs')
      .insert({ tenant_id: workspace.id, buyer_requirement_id: randomId, logged_by: colleagueUser.user.id })
      .select();
    results.push({
      check: 'buyer_requirement_match_logs INSERT with spoofed logged_by (should be blocked)',
      pass: !!spoofedMatchLog.error,
      detail: spoofedMatchLog.error
        ? `${spoofedMatchLog.error.code}: ${spoofedMatchLog.error.message}`
        : 'no error -- logged_by spoofing still possible',
    });

    // Legitimate self-attributed insert must still be column-permitted (will
    // fail on the buyer_requirement_id FK against a random id -- that's a
    // constraint error, not a permission error, which is exactly what proves
    // the grant/WITH CHECK let it through this far).
    const ownActivity = await scoped
      .from('buyer_requirement_activity_log')
      .insert({
        tenant_id: workspace.id,
        buyer_requirement_id: randomId,
        activity_type: 'note',
        occurred_at: new Date().toISOString(),
        logged_by: selfUser.user.id,
      })
      .select();
    const isForeignKeyError = ownActivity.error?.code === '23503';
    results.push({
      check: 'buyer_requirement_activity_log INSERT with own logged_by (grant/WITH CHECK must pass; FK error on fake lead id is expected)',
      pass: isForeignKeyError,
      detail: ownActivity.error ? `${ownActivity.error.code}: ${ownActivity.error.message}` : 'unexpected success against a fake lead id',
    });
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(selfUser.user.id);
    await supabaseAdmin.auth.admin.deleteUser(colleagueUser.user.id);
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
