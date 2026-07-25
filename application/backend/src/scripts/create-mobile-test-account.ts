import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// One-off script for the tb-design-system-brokerage-001 mobile-verification
// follow-up: creates a throwaway brokerage workspace + admin user with a
// known password, bypassing the invite-email flow entirely (SMTP is still
// on Supabase's default sender, deliberately deferred per project memory).
// Run via: npm run --prefix application/backend create-mobile-test-account
const EMAIL = 'danielbacud+residoro-mobile-verify@gmail.com';
const PASSWORD = 'ResidoroMobileVerify123!';

async function main() {
  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({
      name: 'Mobile Verify Test Brokerage',
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
