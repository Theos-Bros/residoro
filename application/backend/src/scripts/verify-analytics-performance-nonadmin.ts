import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// One-off supplement to verify-analytics-performance.ts: the primary test
// account is admin, so this creates a genuinely separate temporary non-admin
// member in the same tenant to confirm the view-all/edit-admin-only split on
// GET/PATCH /settings/performance (mirrors PATCH /settings/share-templates'
// already-verified 403 behavior). Deletes the temp user afterward.
const SUPABASE_URL = process.env.SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;
const EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL!;
const PASSWORD = process.env.MOBILE_TEST_ACCOUNT_PASSWORD!;

async function main() {
  // profiles has no email column -- resolve tenant_id by signing in as the
  // known admin test account first, same as verify-analytics-performance.ts.
  const bootstrapAnon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
  const { data: adminSignIn, error: adminSignInError } = await bootstrapAnon.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (adminSignInError || !adminSignIn.session) {
    throw new Error(`Could not sign in as admin test account: ${adminSignInError?.message}`);
  }
  const { data: adminProfile } = await supabaseAdmin
    .from('profiles')
    .select('tenant_id')
    .eq('id', adminSignIn.user!.id)
    .single();
  const tenantId = adminProfile!.tenant_id;
  console.log(`Using tenant ${tenantId}`);

  const tempEmail = `danielbacud+residoro-tempmember-${Date.now()}@gmail.com`;
  const tempPassword = `Temp-${Math.random().toString(36).slice(2)}!Aa1`;

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: tempEmail,
    password: tempPassword,
    email_confirm: true,
  });
  if (createError || !created.user) throw new Error(`Could not create temp user: ${createError?.message}`);
  console.log(`Created temp user ${tempEmail} (${created.user.id})`);

  // handle_new_user() auto-provisions a brand-new workspace + admin profile
  // for every signup (see platform_foundation.sql) -- fetch that
  // auto-created row so it can be repointed at the real test tenant (as a
  // non-admin member) instead of insert()-ing a second, conflicting row, and
  // so the leftover throwaway workspace can be cleaned up afterward.
  const { data: autoProfile, error: autoProfileError } = await supabaseAdmin
    .from('profiles')
    .select('tenant_id')
    .eq('id', created.user.id)
    .single();
  if (autoProfileError || !autoProfile) throw new Error(`Could not read auto-provisioned profile: ${autoProfileError?.message}`);
  const leftoverWorkspaceId = autoProfile.tenant_id;
  console.log(`Auto-provisioned workspace ${leftoverWorkspaceId} (will be deleted in cleanup)`);

  try {
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ tenant_id: tenantId, role: 'member' })
      .eq('id', created.user.id);
    if (updateError) throw new Error(`Could not repoint temp profile at test tenant: ${updateError.message}`);

    const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
      email: tempEmail,
      password: tempPassword,
    });
    if (signInError || !signIn.session) throw new Error(`Could not sign in as temp member: ${signInError?.message}`);
    const token = signIn.session.access_token;

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

    console.log('\n--- GET /settings/performance as non-admin member -> 200 ---');
    const get = await call('/settings/performance');
    console.log(get);
    if (get.status !== 200) throw new Error('FAIL: non-admin member should still be able to view performance settings');
    console.log('PASS');

    console.log('\n--- PATCH /settings/performance as non-admin member -> 403 ---');
    const patch = await call('/settings/performance', {
      method: 'PATCH',
      body: JSON.stringify({ hot_share_threshold: 99 }),
    });
    console.log(patch);
    if (patch.status !== 403) throw new Error('FAIL: non-admin member editing performance settings should be 403');
    console.log('PASS');

    console.log('\nAll checks passed.');
  } finally {
    await supabaseAdmin.from('profiles').delete().eq('id', created.user.id);
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    await supabaseAdmin.from('workspaces').delete().eq('id', leftoverWorkspaceId);
    console.log('\nCleaned up temp user and its leftover auto-provisioned workspace.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
