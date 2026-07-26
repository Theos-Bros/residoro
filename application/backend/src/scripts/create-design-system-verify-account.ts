import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// One-off script for cap-design-system-001's remaining live-verification gap
// (flagged in tb-design-system-admin-001's What Happens Next): confirms
// ShareDocketForm and the contract-expiry read-only banner/panel render
// correctly, since neither state was exercised during either design-system
// tracer bullet's verification pass. Creates a throwaway brokerage workspace
// already inside the 7-day read-only grace period, with one property +
// active listing so ShareDocketForm has something to share.
// Run via: npm run --prefix application/backend create-design-system-verify-account
const EMAIL = process.env.DESIGN_SYSTEM_VERIFY_ACCOUNT_EMAIL;
const PASSWORD = process.env.DESIGN_SYSTEM_VERIFY_ACCOUNT_PASSWORD;

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Set DESIGN_SYSTEM_VERIFY_ACCOUNT_EMAIL and DESIGN_SYSTEM_VERIFY_ACCOUNT_PASSWORD in .env first.');
    process.exit(1);
  }

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({
      name: 'Design System Verify Test Brokerage',
      contract_start_date: '2026-01-01',
      contract_end_date: '2026-07-23',
      access_state: 'read_only',
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

  const { data: property, error: propertyError } = await supabaseAdmin
    .from('properties')
    .insert({
      tenant_id: workspace.id,
      type: 'condo_unit',
      owner_type: 'individual',
      title: 'Design System Verify Test Unit',
      city: 'Taguig',
      province: 'Metro Manila',
      price: 8500000,
      created_by: userData.user.id,
    })
    .select('id')
    .single();

  if (propertyError || !property) {
    console.error('Could not create property:', propertyError?.message);
    process.exit(1);
  }

  const { error: listingError } = await supabaseAdmin.from('listings').insert({
    tenant_id: workspace.id,
    property_id: property.id,
    agent_id: userData.user.id,
    listing_type: 'sale',
    price: 8500000,
    status: 'active',
  });

  if (listingError) {
    console.error('Could not create listing:', listingError.message);
    process.exit(1);
  }

  console.log(`Created test brokerage workspace ${workspace.id} (access_state: read_only)`);
  console.log(`Login: ${EMAIL} / ${PASSWORD}`);
}

main();
