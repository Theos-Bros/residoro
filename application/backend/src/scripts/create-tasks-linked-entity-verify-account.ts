import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// One-off script for tb-tasks-linked-entity-display-001's live verification:
// creates a throwaway brokerage workspace + admin user with a known
// password. Uses createUser (known password, no email round-trip) then a
// trusted service-role UPDATE on profiles keyed by the returned user id --
// the post-2026-07-29-fix pattern (see 20260729090000_fix_signup_privilege_
// escalation.sql and create-docket-share-test-accounts.ts) -- handle_new_user
// now always creates an inert profile (role='member', tenant_id=null)
// regardless of signup metadata, so assigning tenant_id/role via
// user_metadata (the older create-property-edit-verify-account.ts pattern)
// no longer works.
// Run via: npx tsx src/scripts/create-tasks-linked-entity-verify-account.ts
const EMAIL = process.env.TASKS_LINKED_ENTITY_VERIFY_ACCOUNT_EMAIL;
const PASSWORD = process.env.TASKS_LINKED_ENTITY_VERIFY_ACCOUNT_PASSWORD;

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error(
      'Set TASKS_LINKED_ENTITY_VERIFY_ACCOUNT_EMAIL and TASKS_LINKED_ENTITY_VERIFY_ACCOUNT_PASSWORD in .env first.',
    );
    process.exit(1);
  }

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({
      name: 'Tasks Linked Entity Verify Test Brokerage',
      contract_start_date: '2026-01-01',
      contract_end_date: '2027-01-01',
    })
    .select('id')
    .single();

  if (workspaceError || !workspace) {
    console.error('Could not create workspace:', workspaceError?.message);
    process.exit(1);
  }

  const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
  const existing = existingUsers.users.find((u) => u.email === EMAIL);

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });

    if (userError || !userData.user) {
      console.error('Could not create user:', userError?.message);
      await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
      process.exit(1);
    }
    userId = userData.user.id;
  }

  const { error: assignError } = await supabaseAdmin
    .from('profiles')
    .update({ tenant_id: workspace.id, role: 'admin' })
    .eq('id', userId);

  if (assignError) {
    console.error('Could not assign admin to workspace:', assignError.message);
    process.exit(1);
  }

  console.log(`Created test brokerage workspace ${workspace.id}`);
  console.log(`Login: ${EMAIL} / ${PASSWORD}`);
}

main();
