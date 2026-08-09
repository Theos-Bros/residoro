import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Live DoD verification for tb-brokerage-permissions-delegation-001, mirroring
// verify-analytics-performance-nonadmin.ts's temp-member pattern: creates a
// throwaway non-admin member in the real admin test account's tenant, walks
// every Definition of Done item against the running backend, then cleans up.
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

  const tempEmail = `danielbacud+residoro-permdelegate-${Date.now()}@gmail.com`;
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
      .update({ tenant_id: tenantId, role: 'member', first_name: 'Temp', last_name: 'Delegate' })
      .eq('id', memberId);
    if (updateError) throw new Error(`Could not repoint temp profile at test tenant: ${updateError.message}`);

    const memberAnon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const { data: memberSignIn, error: memberSignInError } = await memberAnon.auth.signInWithPassword({
      email: tempEmail,
      password: tempPassword,
    });
    if (memberSignInError || !memberSignIn.session) throw new Error(`Could not sign in as temp member: ${memberSignInError?.message}`);
    const memberToken = memberSignIn.session.access_token;

    // Same kind of client getScopedClient(request) builds (publishable key +
    // caller's own JWT) -- used below to hit PostgREST DIRECTLY, skipping the
    // backend API entirely, so a pass proves RLS itself is the enforcement,
    // not just this route's own canEditSetting() check. Mirrors
    // verify-rls-scoped-client.ts's pattern for tb-platform-rls-scoped-client-001.
    const memberScoped = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${memberToken}` } },
    });

    // --- DoD: Permissions sub-section is admin-only ---
    const memberGetPermissions = await call(memberToken, '/settings/permissions');
    check('GET /settings/permissions as non-admin -> 403', memberGetPermissions.status === 403, memberGetPermissions);

    const memberPutPermissions = await call(memberToken, `/settings/permissions/${adminId}`, {
      method: 'PUT',
      body: JSON.stringify({ setting_key: 'sharing_templates', granted: true }),
    });
    check('PUT /settings/permissions/:id as non-admin -> 403', memberPutPermissions.status === 403, memberPutPermissions);

    // --- DoD: admin sees every other member with independent toggles ---
    const adminGetPermissions = await call(adminToken, '/settings/permissions');
    check('GET /settings/permissions as admin -> 200', adminGetPermissions.status === 200, adminGetPermissions);
    const tempMemberRow = adminGetPermissions.body.members.find((m: any) => m.member_id === memberId);
    check('temp member appears in the list', !!tempMemberRow, adminGetPermissions.body);
    check(
      'temp member starts with both grants false',
      tempMemberRow.sharing_templates === false && tempMemberRow.performance === false,
      tempMemberRow,
    );
    check(
      "admin's own row is absent from the list",
      !adminGetPermissions.body.members.some((m: any) => m.member_id === adminId),
      adminGetPermissions.body,
    );

    // --- DoD: before any grant, non-admin can view but not edit either sub-section ---
    const beforeShareGet = await call(memberToken, '/settings/share-templates');
    check('GET /settings/share-templates before grant -> can_edit false', beforeShareGet.body.can_edit === false, beforeShareGet.body);
    const beforeSharePatch = await call(memberToken, '/settings/share-templates', {
      method: 'PATCH',
      body: JSON.stringify({ public_share_template: 'should not save' }),
    });
    check('PATCH /settings/share-templates before grant -> 403', beforeSharePatch.status === 403, beforeSharePatch);

    // --- THE ACTUAL RLS PROOF: bypass the backend API entirely, write
    // directly via PostgREST through the member's own scoped client. If this
    // is blocked with no app-level check anywhere in the path, RLS -- not
    // application code -- is what's actually stopping the write. ---
    const directWriteBeforeGrant = await memberScoped
      .from('workspace_sharing_settings')
      .update({ public_share_template: 'direct RLS bypass attempt -- should be blocked' })
      .eq('tenant_id', tenantId)
      .select('public_share_template')
      .maybeSingle();
    check(
      'DIRECT PostgREST write to workspace_sharing_settings before grant is blocked by RLS (no app code involved)',
      directWriteBeforeGrant.data === null || !!directWriteBeforeGrant.error,
      directWriteBeforeGrant,
    );

    // --- DoD: granting a member rejected for an admin target -> 400 ---
    const grantToAdmin = await call(adminToken, `/settings/permissions/${adminId}`, {
      method: 'PUT',
      body: JSON.stringify({ setting_key: 'sharing_templates', granted: true }),
    });
    check('PUT granting a delegation to an admin -> 400', grantToAdmin.status === 400, grantToAdmin);

    // --- DoD: cross-tenant / nonexistent member -> 404 ---
    const grantToUnknown = await call(adminToken, `/settings/permissions/${randomUUID()}`, {
      method: 'PUT',
      body: JSON.stringify({ setting_key: 'sharing_templates', granted: true }),
    });
    check('PUT for a member outside the tenant -> 404', grantToUnknown.status === 404, grantToUnknown);

    // --- DoD: grant sharing_templates, per-key not all-or-nothing ---
    const grant = await call(adminToken, `/settings/permissions/${memberId}`, {
      method: 'PUT',
      body: JSON.stringify({ setting_key: 'sharing_templates', granted: true }),
    });
    check('PUT grant sharing_templates -> 200', grant.status === 200, grant);

    const afterShareGet = await call(memberToken, '/settings/share-templates');
    check('GET /settings/share-templates after grant -> can_edit true', afterShareGet.body.can_edit === true, afterShareGet.body);

    const afterSharePatch = await call(memberToken, '/settings/share-templates', {
      method: 'PATCH',
      body: JSON.stringify({ public_share_template: 'delegated edit works {{title}}' }),
    });
    check('PATCH /settings/share-templates after grant -> 200', afterSharePatch.status === 200, afterSharePatch);
    check(
      'the write actually persisted',
      afterSharePatch.body.public_share_template === 'delegated edit works {{title}}',
      afterSharePatch.body,
    );

    // --- THE ACTUAL RLS PROOF, positive case: same direct PostgREST write,
    // now that a grant exists -- if RLS (not the app) is the real gate, this
    // now succeeds through the member's own scoped client with zero backend
    // involvement. ---
    const directWriteAfterGrant = await memberScoped
      .from('workspace_sharing_settings')
      .update({ public_share_template: 'direct RLS write after grant -- should succeed' })
      .eq('tenant_id', tenantId)
      .select('public_share_template')
      .maybeSingle();
    check(
      'DIRECT PostgREST write to workspace_sharing_settings after grant is allowed by RLS (no app code involved)',
      directWriteAfterGrant.data?.public_share_template === 'direct RLS write after grant -- should succeed',
      directWriteAfterGrant,
    );

    const afterPerformanceGet = await call(memberToken, '/settings/performance');
    check(
      'GET /settings/performance still can_edit false (per-key, not all-or-nothing)',
      afterPerformanceGet.body.can_edit === false,
      afterPerformanceGet.body,
    );
    const afterPerformancePatch = await call(memberToken, '/settings/performance', {
      method: 'PATCH',
      body: JSON.stringify({ hot_share_threshold: 7 }),
    });
    check('PATCH /settings/performance still 403 for the ungranted key', afterPerformancePatch.status === 403, afterPerformancePatch);

    // --- THE ACTUAL RLS PROOF, cross-setting case: a sharing_templates grant
    // must NOT leak into performance -- direct write, RLS's own doing. ---
    const directPerformanceWrite = await memberScoped
      .from('workspace_performance_settings')
      .update({ hot_share_threshold: 99 })
      .eq('tenant_id', tenantId)
      .select('hot_share_threshold')
      .maybeSingle();
    check(
      'DIRECT PostgREST write to workspace_performance_settings stays blocked despite the sharing_templates grant (per-setting RLS, not per-row)',
      directPerformanceWrite.data === null || !!directPerformanceWrite.error,
      directPerformanceWrite,
    );

    // --- DoD: revoking flips can_edit back and the next PATCH 403s again ---
    const revoke = await call(adminToken, `/settings/permissions/${memberId}`, {
      method: 'PUT',
      body: JSON.stringify({ setting_key: 'sharing_templates', granted: false }),
    });
    check('PUT revoke sharing_templates -> 200', revoke.status === 200, revoke);

    const afterRevokeGet = await call(memberToken, '/settings/share-templates');
    check('GET /settings/share-templates after revoke -> can_edit false', afterRevokeGet.body.can_edit === false, afterRevokeGet.body);
    const afterRevokePatch = await call(memberToken, '/settings/share-templates', {
      method: 'PATCH',
      body: JSON.stringify({ public_share_template: 'should be rejected now' }),
    });
    check('PATCH /settings/share-templates after revoke -> 403', afterRevokePatch.status === 403, afterRevokePatch);

    // --- DoD: admin's own can_edit is always true regardless of delegation table ---
    const adminShareGet = await call(adminToken, '/settings/share-templates');
    check("admin's own GET /settings/share-templates -> can_edit true", adminShareGet.body.can_edit === true, adminShareGet.body);
    const adminPerformanceGet = await call(adminToken, '/settings/performance');
    check("admin's own GET /settings/performance -> can_edit true", adminPerformanceGet.body.can_edit === true, adminPerformanceGet.body);

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
