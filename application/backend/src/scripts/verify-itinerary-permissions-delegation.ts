import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Live DoD verification for tb-brokerage-permissions-itinerary-delegation-001,
// mirroring verify-brokerage-permissions-delegation.ts's temp-member pattern
// but scoped to the one new key ('itinerary') this tracer bullet adds to the
// Permissions grid -- the RLS/route enforcement was already covered by
// tb-buyer-leads-itinerary-settings-001's own verification.
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

  const tempEmail = `danielbacud+residoro-itindelegate-${Date.now()}@gmail.com`;
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
      .update({ tenant_id: tenantId, role: 'member', full_name: 'Temp Itinerary Delegate' })
      .eq('id', memberId);
    if (updateError) throw new Error(`Could not repoint temp profile at test tenant: ${updateError.message}`);

    const memberAnon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const { data: memberSignIn, error: memberSignInError } = await memberAnon.auth.signInWithPassword({
      email: tempEmail,
      password: tempPassword,
    });
    if (memberSignInError || !memberSignIn.session) throw new Error(`Could not sign in as temp member: ${memberSignInError?.message}`);
    const memberToken = memberSignIn.session.access_token;

    // --- DoD: grid response includes an `itinerary` field, starts false ---
    const adminGetPermissions = await call(adminToken, '/settings/permissions');
    check('GET /settings/permissions as admin -> 200', adminGetPermissions.status === 200, adminGetPermissions);
    const tempMemberRow = adminGetPermissions.body.members.find((m: any) => m.member_id === memberId);
    check('temp member appears in the list', !!tempMemberRow, adminGetPermissions.body);
    check("temp member's itinerary field exists and starts false", tempMemberRow.itinerary === false, tempMemberRow);

    // --- DoD: before any grant, non-admin can view but not edit itinerary settings ---
    const beforeGet = await call(memberToken, '/settings/itinerary');
    check('GET /settings/itinerary before grant -> can_edit false', beforeGet.body.can_edit === false, beforeGet.body);
    const beforePatch = await call(memberToken, '/settings/itinerary', {
      method: 'PATCH',
      body: JSON.stringify({ recipient_email: 'should-not-save@example.com' }),
    });
    check('PATCH /settings/itinerary before grant -> 403', beforePatch.status === 403, beforePatch);

    // --- DoD: SETTING_KEYS now accepts 'itinerary' -- grant via the grid ---
    const grant = await call(adminToken, `/settings/permissions/${memberId}`, {
      method: 'PUT',
      body: JSON.stringify({ setting_key: 'itinerary', granted: true }),
    });
    check('PUT grant itinerary -> 200', grant.status === 200, grant);

    const afterGrantList = await call(adminToken, '/settings/permissions');
    const grantedRow = afterGrantList.body.members.find((m: any) => m.member_id === memberId);
    check('grid reflects the itinerary grant (per-key, not all-or-nothing)', grantedRow.itinerary === true && grantedRow.sharing_templates === false, grantedRow);

    // --- DoD: can_edit flips true, PATCH succeeds and persists ---
    const afterGrantGet = await call(memberToken, '/settings/itinerary');
    check('GET /settings/itinerary after grant -> can_edit true', afterGrantGet.body.can_edit === true, afterGrantGet.body);

    const afterGrantPatch = await call(memberToken, '/settings/itinerary', {
      method: 'PATCH',
      body: JSON.stringify({ recipient_email: 'delegated-edit-works@example.com' }),
    });
    check('PATCH /settings/itinerary after grant -> 200', afterGrantPatch.status === 200, afterGrantPatch);
    check(
      'the write actually persisted',
      afterGrantPatch.body.recipient_email === 'delegated-edit-works@example.com',
      afterGrantPatch.body,
    );

    // --- DoD: other delegation-gated settings unaffected by this grant ---
    const afterGrantPerformanceGet = await call(memberToken, '/settings/performance');
    check(
      'GET /settings/performance still can_edit false (per-key, not all-or-nothing)',
      afterGrantPerformanceGet.body.can_edit === false,
      afterGrantPerformanceGet.body,
    );

    // --- DoD: revoking flips can_edit back and the next PATCH 403s again ---
    const revoke = await call(adminToken, `/settings/permissions/${memberId}`, {
      method: 'PUT',
      body: JSON.stringify({ setting_key: 'itinerary', granted: false }),
    });
    check('PUT revoke itinerary -> 200', revoke.status === 200, revoke);

    const afterRevokeGet = await call(memberToken, '/settings/itinerary');
    check('GET /settings/itinerary after revoke -> can_edit false', afterRevokeGet.body.can_edit === false, afterRevokeGet.body);
    const afterRevokePatch = await call(memberToken, '/settings/itinerary', {
      method: 'PATCH',
      body: JSON.stringify({ recipient_email: 'should-be-rejected-now@example.com' }),
    });
    check('PATCH /settings/itinerary after revoke -> 403', afterRevokePatch.status === 403, afterRevokePatch);

    // --- DoD regression: admin's own can_edit is always true regardless of delegation table ---
    const adminItineraryGet = await call(adminToken, '/settings/itinerary');
    check("admin's own GET /settings/itinerary -> can_edit true", adminItineraryGet.body.can_edit === true, adminItineraryGet.body);

    // --- DoD regression: the five pre-existing columns still work unchanged ---
    const shareGrant = await call(adminToken, `/settings/permissions/${memberId}`, {
      method: 'PUT',
      body: JSON.stringify({ setting_key: 'sharing_templates', granted: true }),
    });
    check('PUT grant sharing_templates (pre-existing column) still -> 200', shareGrant.status === 200, shareGrant);
    const shareGet = await call(memberToken, '/settings/share-templates');
    check('GET /settings/share-templates after grant -> can_edit true (regression)', shareGet.body.can_edit === true, shareGet.body);

    console.log(`\nAll ${passed} checks passed.`);
  } finally {
    await supabaseAdmin.from('settings_edit_delegations').delete().eq('member_id', memberId);
    await supabaseAdmin.from('profiles').delete().eq('id', memberId);
    await supabaseAdmin.auth.admin.deleteUser(memberId);
    await supabaseAdmin.from('workspaces').delete().eq('id', leftoverWorkspaceId);
    console.log('Cleaned up temp user, its delegation rows, and its leftover auto-provisioned workspace.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
