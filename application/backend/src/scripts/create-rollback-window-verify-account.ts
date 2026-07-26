import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// One-off throwaway-account script for tb-migration-rollback-window-001's
// live verification: creates a test brokerage workspace, a tenant admin user
// (to run a CSV migration against it), and a test operator user (to call the
// new PATCH /admin/clients/:id/rollback-policy endpoint) -- both with known
// passwords set directly, bypassing the invite-email flow entirely, same
// pattern as create-mobile-test-account.ts.
// Run via: npm run --prefix application/backend create-rollback-window-verify-account
const TENANT_EMAIL = process.env.ROLLBACK_WINDOW_VERIFY_TENANT_EMAIL;
const TENANT_PASSWORD = process.env.ROLLBACK_WINDOW_VERIFY_TENANT_PASSWORD;
const OPERATOR_EMAIL = process.env.ROLLBACK_WINDOW_VERIFY_OPERATOR_EMAIL;
const OPERATOR_PASSWORD = process.env.ROLLBACK_WINDOW_VERIFY_OPERATOR_PASSWORD;

async function main() {
  if (!TENANT_EMAIL || !TENANT_PASSWORD || !OPERATOR_EMAIL || !OPERATOR_PASSWORD) {
    console.error(
      'Set ROLLBACK_WINDOW_VERIFY_TENANT_EMAIL/PASSWORD and ROLLBACK_WINDOW_VERIFY_OPERATOR_EMAIL/PASSWORD in .env first.',
    );
    process.exit(1);
  }

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({
      name: 'Rollback Window Verify Test Brokerage',
      contract_start_date: '2026-01-01',
      contract_end_date: '2027-01-01',
    })
    .select('id')
    .single();

  if (workspaceError || !workspace) {
    console.error('Could not create workspace:', workspaceError?.message);
    process.exit(1);
  }

  const { data: tenantUser, error: tenantError } = await supabaseAdmin.auth.admin.createUser({
    email: TENANT_EMAIL,
    password: TENANT_PASSWORD,
    email_confirm: true,
    user_metadata: { tenant_id: workspace.id },
  });

  if (tenantError || !tenantUser.user) {
    console.error('Could not create tenant user:', tenantError?.message);
    await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
    process.exit(1);
  }

  const { data: operatorUser, error: operatorError } = await supabaseAdmin.auth.admin.createUser({
    email: OPERATOR_EMAIL,
    password: OPERATOR_PASSWORD,
    email_confirm: true,
    user_metadata: { app_role: 'operator' },
  });

  if (operatorError || !operatorUser.user) {
    console.error('Could not create operator user:', operatorError?.message);
    process.exit(1);
  }

  console.log(`Created test workspace: ${workspace.id}`);
  console.log(`Tenant login: ${TENANT_EMAIL} / ${TENANT_PASSWORD}`);
  console.log(`Operator login: ${OPERATOR_EMAIL} / ${OPERATOR_PASSWORD}`);
}

main();
