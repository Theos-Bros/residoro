import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-properties-project-link-001 DoD verification. Drives the real running
// backend (npx tsx src/index.ts must already be running in another
// terminal) end to end against two throwaway tenants -- a second tenant is
// needed here (unlike most other verify-*.ts scripts, which reuse a single
// persistent test account) specifically to prove the cross-tenant 404 case.
//
// 2026-07-29 security review: handle_new_user() now always creates an inert
// profile (role='member', tenant_id=null) regardless of signup metadata --
// this script assigns tenant_id/role via a direct service-role UPDATE right
// after createUser, the same trusted pattern POST /admin/clients
// (application/backend/src/routes/admin.ts) uses. The older create-*-verify-
// account.ts scripts in this directory predate that fix and still rely on
// user_metadata.tenant_id, which the trigger no longer reads -- don't copy
// that pattern for any *new* script.
//
// Cleanup order matters: workspace_sharing_settings/workspace_performance_
// settings/workspace_matching_settings are auto-seeded per-tenant by
// trg_provision_workspace_settings_defaults (20260728171500) with no ON
// DELETE CASCADE back to workspaces, so they must be deleted before the
// workspace row itself or that delete 23503s.
//
// Run via (from application/backend, with the backend dev server already
// running in another terminal):
// npx tsx src/scripts/verify-properties-project-link.ts
const EMAIL_A = process.env.PROJECT_LINK_VERIFY_ACCOUNT_A_EMAIL;
const PASSWORD_A = process.env.PROJECT_LINK_VERIFY_ACCOUNT_A_PASSWORD;
const EMAIL_B = process.env.PROJECT_LINK_VERIFY_ACCOUNT_B_EMAIL;
const PASSWORD_B = process.env.PROJECT_LINK_VERIFY_ACCOUNT_B_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;

type CallFn = (path: string, init?: RequestInit) => Promise<{ status: number; body: any }>;

async function main() {
  if (!EMAIL_A || !PASSWORD_A || !EMAIL_B || !PASSWORD_B || !SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error(
      'Set PROJECT_LINK_VERIFY_ACCOUNT_A_EMAIL/PASSWORD, PROJECT_LINK_VERIFY_ACCOUNT_B_EMAIL/PASSWORD, ' +
        'SUPABASE_URL, and SUPABASE_PUBLISHABLE_KEY in .env first.',
    );
    process.exit(1);
  }

  const workspaceIds: string[] = [];
  const userIds: string[] = [];
  const contactIds: string[] = [];
  const projectIds: string[] = [];
  const propertyIds: string[] = [];

  function callAs(token: string): CallFn {
    return async (path, init = {}) => {
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
    };
  }

  async function createTenant(label: string, email: string, password: string): Promise<CallFn> {
    const { data: workspace, error: workspaceError } = await supabaseAdmin
      .from('workspaces')
      .insert({
        name: `Project Link Verify Tenant ${label}`,
        contract_start_date: '2026-01-01',
        contract_end_date: '2027-01-01',
      })
      .select('id')
      .single();
    if (workspaceError || !workspace) throw new Error(`create workspace ${label}: ${workspaceError?.message}`);
    workspaceIds.push(workspace.id);

    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (userError || !userData.user) throw new Error(`create user ${label}: ${userError?.message}`);
    userIds.push(userData.user.id);

    const { error: assignError } = await supabaseAdmin
      .from('profiles')
      .update({ tenant_id: workspace.id, role: 'admin' })
      .eq('id', userData.user.id);
    if (assignError) throw new Error(`assign admin ${label}: ${assignError.message}`);

    const anon = createClient(SUPABASE_URL as string, PUBLISHABLE_KEY as string);
    const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });
    if (signInError || !signIn.session) throw new Error(`sign in ${label}: ${signInError?.message}`);

    return callAs(signIn.session.access_token);
  }

  try {
    console.log('--- Setup: two tenants (A, B), each with an admin + a developer + a project ---');
    const callA = await createTenant('A', EMAIL_A, PASSWORD_A);
    const callB = await createTenant('B', EMAIL_B, PASSWORD_B);
    const suffix = Date.now();

    const devA = await callA('/developers', {
      method: 'POST',
      body: JSON.stringify({ name: `Project Link Verify Developer A ${suffix}` }),
    });
    if (devA.status !== 201) throw new Error(`FAIL setup: developer A: ${JSON.stringify(devA.body)}`);
    contactIds.push(devA.body.id);

    const projA = await callA('/projects', {
      method: 'POST',
      body: JSON.stringify({ developer_id: devA.body.id, name: `Project Link Verify Project A ${suffix}`, project_type: 'condo' }),
    });
    if (projA.status !== 201) throw new Error(`FAIL setup: project A: ${JSON.stringify(projA.body)}`);
    projectIds.push(projA.body.id);

    const devB = await callB('/developers', {
      method: 'POST',
      body: JSON.stringify({ name: `Project Link Verify Developer B ${suffix}` }),
    });
    if (devB.status !== 201) throw new Error(`FAIL setup: developer B: ${JSON.stringify(devB.body)}`);
    contactIds.push(devB.body.id);

    const projB = await callB('/projects', {
      method: 'POST',
      body: JSON.stringify({ developer_id: devB.body.id, name: `Project Link Verify Project B ${suffix}`, project_type: 'condo' }),
    });
    if (projB.status !== 201) throw new Error(`FAIL setup: project B: ${JSON.stringify(projB.body)}`);
    projectIds.push(projB.body.id);
    console.log('PASS (setup)');

    console.log("\n--- 1. Non-developer property + project_id -> 400 ---");
    const nonDevProp = await callA('/properties', {
      method: 'POST',
      body: JSON.stringify({
        title: `Project Link Verify Individual Unit ${suffix}`,
        type: 'condo_unit',
        owner_type: 'individual',
        city: 'Taguig',
        province: 'Metro Manila',
      }),
    });
    if (nonDevProp.status !== 201) throw new Error(`FAIL setup: individual property: ${JSON.stringify(nonDevProp.body)}`);
    propertyIds.push(nonDevProp.body.id);

    const nonDevLink = await callA(`/properties/${nonDevProp.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ project_id: projA.body.id }),
    });
    if (nonDevLink.status !== 400) {
      throw new Error(`FAIL: expected 400, got ${nonDevLink.status}: ${JSON.stringify(nonDevLink.body)}`);
    }
    console.log(`PASS (400: ${nonDevLink.body.error})`);

    console.log('\n--- 2. project_id: null clears unconditionally, even on a non-developer property ---');
    const clearNonDev = await callA(`/properties/${nonDevProp.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ project_id: null }),
    });
    if (clearNonDev.status !== 200 || clearNonDev.body.project_id !== null) {
      throw new Error(`FAIL: expected 200 project_id=null, got ${JSON.stringify(clearNonDev.body)}`);
    }
    console.log('PASS (200, project_id stayed/cleared to null on a non-developer property)');

    console.log("\n--- 3. Developer-owned property + valid same-tenant project_id -> 200 ---");
    const devProp = await callA('/properties', {
      method: 'POST',
      body: JSON.stringify({
        title: `Project Link Verify Developer Unit ${suffix}`,
        type: 'condo_unit',
        owner_type: 'developer',
        city: 'Taguig',
        province: 'Metro Manila',
      }),
    });
    if (devProp.status !== 201) throw new Error(`FAIL setup: developer property: ${JSON.stringify(devProp.body)}`);
    propertyIds.push(devProp.body.id);

    const link = await callA(`/properties/${devProp.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ project_id: projA.body.id }),
    });
    if (link.status !== 200 || link.body.project_id !== projA.body.id) {
      throw new Error(`FAIL: expected 200 project_id=${projA.body.id}, got ${JSON.stringify(link.body)}`);
    }
    console.log(`PASS (200, project_id=${link.body.project_id})`);

    console.log('\n--- 4. Units-summary rollup reflects the newly-linked property immediately ---');
    const summary = await callA(`/projects/${projA.body.id}/units-summary`);
    if (summary.status !== 200) throw new Error(`FAIL: units-summary: ${JSON.stringify(summary.body)}`);
    const label = devProp.body.title as string;
    const found = (summary.body.by_unit_type as any[]).some((bucket) =>
      Object.values(bucket.units_by_status as Record<string, string[]>).some((labels) => labels.includes(label)),
    );
    if (!found) throw new Error(`FAIL: newly-linked property's label not found in units-summary: ${JSON.stringify(summary.body)}`);
    console.log('PASS (units-summary rollup includes the newly-linked unit)');

    console.log("\n--- 5. Cross-tenant: tenant B's project_id on tenant A's property -> 404 ---");
    const crossTenant = await callA(`/properties/${devProp.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ project_id: projB.body.id }),
    });
    if (crossTenant.status !== 404) {
      throw new Error(`FAIL: expected 404, got ${crossTenant.status}: ${JSON.stringify(crossTenant.body)}`);
    }
    console.log(`PASS (404: ${crossTenant.body.error})`);

    console.log('\n--- 6. Unlink (project_id: null) on the now-linked developer property ---');
    const unlink = await callA(`/properties/${devProp.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ project_id: null }),
    });
    if (unlink.status !== 200 || unlink.body.project_id !== null) {
      throw new Error(`FAIL: expected 200 project_id=null, got ${JSON.stringify(unlink.body)}`);
    }
    console.log('PASS (200, unlinked)');

    console.log('\n=== ALL DOD CHECKS PASSED ===');
  } finally {
    console.log('\n--- Cleanup ---');
    for (const id of propertyIds) {
      const { error } = await supabaseAdmin.from('properties').delete().eq('id', id);
      if (error) console.error(`cleanup: delete property ${id}: ${error.message}`);
    }
    for (const id of projectIds) {
      const { error } = await supabaseAdmin.from('projects').delete().eq('id', id);
      if (error) console.error(`cleanup: delete project ${id}: ${error.message}`);
    }
    for (const id of contactIds) {
      const { error } = await supabaseAdmin.from('contacts').delete().eq('id', id);
      if (error) console.error(`cleanup: delete contact ${id}: ${error.message}`);
    }
    // Auto-seeded per-tenant settings rows (trg_provision_workspace_settings_
    // defaults, 20260728171500) -- no ON DELETE CASCADE back to workspaces,
    // so these must go before the workspace row itself.
    for (const id of workspaceIds) {
      const { error } = await supabaseAdmin.from('workspace_sharing_settings').delete().eq('tenant_id', id);
      if (error) console.error(`cleanup: delete workspace_sharing_settings ${id}: ${error.message}`);
    }
    for (const id of workspaceIds) {
      const { error } = await supabaseAdmin.from('workspace_performance_settings').delete().eq('tenant_id', id);
      if (error) console.error(`cleanup: delete workspace_performance_settings ${id}: ${error.message}`);
    }
    for (const id of workspaceIds) {
      const { error } = await supabaseAdmin.from('workspace_matching_settings').delete().eq('tenant_id', id);
      if (error) console.error(`cleanup: delete workspace_matching_settings ${id}: ${error.message}`);
    }
    for (const id of workspaceIds) {
      const { error } = await supabaseAdmin.from('workspaces').delete().eq('id', id);
      if (error) console.error(`cleanup: delete workspace ${id}: ${error.message}`);
    }
    for (const id of userIds) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (error) console.error(`cleanup: delete user ${id}: ${error.message}`);
    }
    console.log(
      `Cleaned up ${propertyIds.length} properties, ${projectIds.length} projects, ${contactIds.length} contacts, ` +
        `${workspaceIds.length} workspaces (+ their settings rows), ${userIds.length} users.`,
    );
  }
}

main().catch((err) => {
  console.error('\n=== VERIFICATION FAILED ===');
  console.error(err);
  process.exit(1);
});
