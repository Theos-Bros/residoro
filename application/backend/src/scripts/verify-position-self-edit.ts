import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Live verification for 20260810190000_profiles_position_self_edit.sql
// (tb-user-profile-position-self-edit-001). Creates one disposable member
// account, signs in with only the publishable key, and confirms: (a) a
// direct PostgREST write to profiles.position now succeeds (the new
// self-service grant), and (b) role/tenant_id are still rejected (the
// 20260810170000 lockdown is untouched by this migration). Deletes
// everything it created afterward.
// Run via: npx tsx src/scripts/verify-position-self-edit.ts
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env first.');
    process.exit(1);
  }

  const suffix = Date.now();
  const email = `danielbacud+position-self-edit-verify-${suffix}@gmail.com`;
  const password = 'PositionSelfEditVerify123!';

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !userData.user) {
    console.error('user create failed:', userError?.message);
    process.exit(1);
  }

  const results: { check: string; pass: boolean; detail: string }[] = [];

  try {
    const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const signIn = await anon.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data.session) throw new Error(`sign-in: ${signIn.error?.message}`);

    const scoped = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${signIn.data.session.access_token}` } },
    });

    const positionWrite = await scoped
      .from('profiles')
      .update({ position: 'Senior Agent' })
      .eq('id', userData.user.id)
      .select('position');
    results.push({
      check: 'update position (should now succeed)',
      pass: !positionWrite.error && positionWrite.data?.[0]?.position === 'Senior Agent',
      detail: positionWrite.error ? positionWrite.error.message : JSON.stringify(positionWrite.data),
    });

    const roleWrite = await scoped.from('profiles').update({ role: 'admin' }).eq('id', userData.user.id).select();
    results.push({
      check: 'update role (should still be blocked)',
      pass: !!roleWrite.error || (roleWrite.data?.length ?? 0) === 0,
      detail: roleWrite.error ? `${roleWrite.error.code}: ${roleWrite.error.message}` : `no error, rows: ${roleWrite.data?.length}`,
    });

    const otherTenantId = '00000000-0000-0000-0000-000000000000';
    const tenantWrite = await scoped
      .from('profiles')
      .update({ tenant_id: otherTenantId })
      .eq('id', userData.user.id)
      .select();
    results.push({
      check: 'update tenant_id (should still be blocked)',
      pass: !!tenantWrite.error || (tenantWrite.data?.length ?? 0) === 0,
      detail: tenantWrite.error
        ? `${tenantWrite.error.code}: ${tenantWrite.error.message}`
        : `no error, rows: ${tenantWrite.data?.length}`,
    });
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(userData.user.id);
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
