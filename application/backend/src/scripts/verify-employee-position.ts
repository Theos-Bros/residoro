import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-employee-position-001 DoD verification:
//   1. PATCH /workspace/members/:id/position -- admin-only (403 otherwise),
//      verifies target is in caller's own tenant (404 otherwise), free text,
//      empty string clears to null.
//   2. GET /workspace/members and GET /me/profile both include position.
//   3. Regression: a member cannot set anyone's position -- not through the
//      admin route (403), and not through a DIRECT PostgREST write via their
//      own scoped client (no grant exists at all, proving the no-grant
//      approach -- not just the route's own role check -- is what's really
//      stopping self-service writes).
// Requires the local backend dev server running (npm run dev, from
// application/backend) for these HTTP calls.
// Run via (from application/backend): npx tsx src/scripts/verify-employee-position.ts
const SUPABASE_URL = process.env.SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;
const EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL!;
const PASSWORD = process.env.MOBILE_TEST_ACCOUNT_PASSWORD!;

let passed = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (!condition) {
    console.error(`FAIL: ${label}`, detail ?? '');
    throw new Error(`FAIL: ${label}`);
  }
  passed += 1;
  console.log(`PASS: ${label}`);
}

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

async function main() {
  const bootstrapAnon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
  const { data: adminSignIn, error: adminSignInError } = await bootstrapAnon.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (adminSignInError || !adminSignIn.session) {
    throw new Error(`Could not sign in as admin test account: ${adminSignInError?.message}`);
  }
  const adminToken = adminSignIn.session.access_token;
  const adminId = adminSignIn.user!.id;

  const { data: adminProfile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', adminId).single();
  const tenantId = adminProfile!.tenant_id;
  console.log(`Using tenant ${tenantId}, admin ${adminId}`);

  const tempEmail = `danielbacud+residoro-position-${Date.now()}@gmail.com`;
  const tempPassword = `Temp-${Math.random().toString(36).slice(2)}!Aa1`;

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: tempEmail,
    password: tempPassword,
    email_confirm: true,
  });
  if (createError || !created.user) throw new Error(`Could not create temp user: ${createError?.message}`);
  const memberId = created.user.id;
  console.log(`Created temp user ${tempEmail} (${memberId})`);

  const { data: autoProfile, error: autoProfileError } = await supabaseAdmin
    .from('profiles')
    .select('tenant_id')
    .eq('id', memberId)
    .single();
  if (autoProfileError || !autoProfile) throw new Error(`Could not read auto-provisioned profile: ${autoProfileError?.message}`);
  const leftoverWorkspaceId = autoProfile.tenant_id;

  try {
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ tenant_id: tenantId, role: 'member', first_name: 'Temp', last_name: 'PositionVerify' })
      .eq('id', memberId);
    if (updateError) throw new Error(`Could not repoint temp profile at test tenant: ${updateError.message}`);

    const memberAnon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const { data: memberSignIn, error: memberSignInError } = await memberAnon.auth.signInWithPassword({
      email: tempEmail,
      password: tempPassword,
    });
    if (memberSignInError || !memberSignIn.session) throw new Error(`Could not sign in as temp member: ${memberSignInError?.message}`);
    const memberToken = memberSignIn.session.access_token;

    const memberScoped = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${memberToken}` } },
    });

    // --- DoD: GET /workspace/members and GET /me/profile both include position, starting null ---
    const membersBefore = await call(adminToken, '/workspace/members');
    const tempRowBefore = membersBefore.body.members.find((m: any) => m.id === memberId);
    check('GET /workspace/members includes position, starts null', tempRowBefore?.position === null, tempRowBefore);

    const memberProfileBefore = await call(memberToken, '/me/profile');
    check('GET /me/profile includes position, starts null', memberProfileBefore.body.position === null, memberProfileBefore.body);

    // --- DoD: non-admin cannot set anyone's position via the admin route ---
    const memberTriesSetOwn = await call(memberToken, `/workspace/members/${memberId}/position`, {
      method: 'PATCH',
      body: JSON.stringify({ position: 'Self-Appointed Boss' }),
    });
    check('PATCH .../position as non-admin (even on own id) -> 403', memberTriesSetOwn.status === 403, memberTriesSetOwn);

    // --- THE ACTUAL NO-GRANT PROOF: direct PostgREST write via the member's
    // own scoped client, bypassing the backend API entirely. If this is
    // blocked with no app-level check anywhere in the path, the missing
    // grant -- not just the route's role check -- is what's really stopping
    // self-service writes. ---
    const directWrite = await memberScoped
      .from('profiles')
      .update({ position: 'Direct write attempt -- should be blocked' })
      .eq('id', memberId)
      .select('position')
      .maybeSingle();
    check(
      'DIRECT PostgREST write to profiles.position is blocked (no grant exists, no app code involved)',
      directWrite.error !== null,
      directWrite,
    );

    // --- DoD: cross-tenant / nonexistent member -> 404 ---
    const setForUnknown = await call(adminToken, `/workspace/members/${crypto.randomUUID()}/position`, {
      method: 'PATCH',
      body: JSON.stringify({ position: 'Should not matter' }),
    });
    check('PATCH .../position for a member outside the tenant -> 404', setForUnknown.status === 404, setForUnknown);

    // --- DoD: admin sets a real position ---
    const setPosition = await call(adminToken, `/workspace/members/${memberId}/position`, {
      method: 'PATCH',
      body: JSON.stringify({ position: 'Senior Agent' }),
    });
    check('PATCH .../position as admin -> 200, returns the new value', setPosition.status === 200 && setPosition.body.position === 'Senior Agent', setPosition);

    const membersAfter = await call(adminToken, '/workspace/members');
    const tempRowAfter = membersAfter.body.members.find((m: any) => m.id === memberId);
    check('GET /workspace/members reflects the new position', tempRowAfter?.position === 'Senior Agent', tempRowAfter);

    const memberProfileAfter = await call(memberToken, '/me/profile');
    check(
      "the affected member's own GET /me/profile reflects the new position (read-only)",
      memberProfileAfter.body.position === 'Senior Agent',
      memberProfileAfter.body,
    );

    // --- DoD: empty string clears position to null ---
    const clearPosition = await call(adminToken, `/workspace/members/${memberId}/position`, {
      method: 'PATCH',
      body: JSON.stringify({ position: '' }),
    });
    check('PATCH .../position with empty string clears to null', clearPosition.status === 200 && clearPosition.body.position === null, clearPosition);

    console.log(`\nAll ${passed} checks passed.`);
  } finally {
    await supabaseAdmin.from('profiles').delete().eq('id', memberId);
    await supabaseAdmin.auth.admin.deleteUser(memberId);
    await supabaseAdmin.from('workspaces').delete().eq('id', leftoverWorkspaceId);
    console.log('Cleaned up temp user and its leftover auto-provisioned workspace.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
