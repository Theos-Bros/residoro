import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// One-off script for tb-properties-edit-001's live verification: creates a
// throwaway brokerage workspace + admin user with a known password,
// bypassing the invite-email flow entirely (SMTP is still on Supabase's
// default sender, deliberately deferred per project memory).
// Run via: npx tsx src/scripts/create-property-edit-verify-account.ts
const EMAIL = process.env.PROPERTY_EDIT_VERIFY_ACCOUNT_EMAIL;
const PASSWORD = process.env.PROPERTY_EDIT_VERIFY_ACCOUNT_PASSWORD;

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Set PROPERTY_EDIT_VERIFY_ACCOUNT_EMAIL and PROPERTY_EDIT_VERIFY_ACCOUNT_PASSWORD in .env first.');
    process.exit(1);
  }

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({
      name: 'Property Edit Verify Test Brokerage',
      contract_start_date: '2026-01-01',
      contract_end_date: '2027-01-01',
    })
    .select('id')
    .single();

  if (workspaceError || !workspace) {
    console.error('Could not create workspace:', workspaceError?.message);
    process.exit(1);
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { tenant_id: workspace.id },
  });

  if (userError || !userData.user) {
    console.error('Could not create user:', userError?.message);
    await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
    process.exit(1);
  }

  console.log(`Created test brokerage workspace ${workspace.id}`);
  console.log(`Login: ${EMAIL} / ${PASSWORD}`);
}

main();
