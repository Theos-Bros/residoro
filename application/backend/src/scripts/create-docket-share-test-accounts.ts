import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Manual-testing fixture for tb-listings-co-broker-share-001 (cross-brokerage docket sharing):
// two persistent admin accounts in two separate workspaces, plus an active listing (open
// exclusivity, open-ended authority) in Brokerage A so there's something to "Share as docket"
// immediately. Uses createUser (known password, no email round-trip) rather than
// inviteUserByEmail, then a trusted service-role UPDATE on profiles keyed by the returned user
// id -- the same post-2026-07-29-fix pattern admin.ts's real client-enrollment route uses,
// never via user_metadata. Kept, not cleaned up -- meant to be logged into manually.
// Run via: npx tsx src/scripts/create-docket-share-test-accounts.ts

const BROKERAGE_A = {
  workspaceName: 'Docket Share Test Brokerage A',
  email: 'danielbacud+docket-share-a@gmail.com',
  password: 'DocketShareTestA123!',
};
const BROKERAGE_B = {
  workspaceName: 'Docket Share Test Brokerage B',
  email: 'danielbacud+docket-share-b@gmail.com',
  password: 'DocketShareTestB123!',
};

async function ensureBrokerageAdmin(config: { workspaceName: string; email: string; password: string }) {
  const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
  const existing = existingUsers.users.find((u) => u.email === config.email);
  if (existing) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id, handle')
      .eq('id', existing.id)
      .single();
    if (profile?.tenant_id) {
      console.log(`${config.email} already exists, tenant ${profile.tenant_id}, handle @${profile.handle}`);
      return { userId: existing.id, tenantId: profile.tenant_id, handle: profile.handle as string };
    }
  }

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({
      name: config.workspaceName,
      contract_start_date: '2026-01-01',
      contract_end_date: '2027-01-01',
    })
    .select('id')
    .single();
  if (workspaceError || !workspace) throw new Error(`Could not create workspace: ${workspaceError?.message}`);

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: config.email,
      password: config.password,
      email_confirm: true,
    });
    if (createError || !created.user) throw new Error(`Could not create user: ${createError?.message}`);
    userId = created.user.id;
  }

  const { error: assignError } = await supabaseAdmin
    .from('profiles')
    .update({ tenant_id: workspace.id, role: 'admin' })
    .eq('id', userId);
  if (assignError) throw new Error(`Could not assign admin to workspace: ${assignError.message}`);

  const { data: profile } = await supabaseAdmin.from('profiles').select('handle').eq('id', userId).single();

  console.log(`Created ${config.email}, tenant ${workspace.id}, handle @${profile!.handle}`);
  return { userId, tenantId: workspace.id, handle: profile!.handle as string };
}

async function main() {
  const a = await ensureBrokerageAdmin(BROKERAGE_A);
  const b = await ensureBrokerageAdmin(BROKERAGE_B);

  const { data: existingListing } = await supabaseAdmin
    .from('listings')
    .select('id, properties!inner(tenant_id)')
    .eq('properties.tenant_id', a.tenantId)
    .limit(1)
    .maybeSingle();

  let listingId = existingListing?.id as string | undefined;
  if (!listingId) {
    const { data: property, error: propertyError } = await supabaseAdmin
      .from('properties')
      .insert({
        tenant_id: a.tenantId,
        created_by: a.userId,
        title: 'Docket Share Test Unit',
        type: 'condo_unit',
        owner_type: 'individual',
        city: 'Taguig',
        province: 'Metro Manila',
        price: 5000000,
      })
      .select('id')
      .single();
    if (propertyError || !property) throw new Error(`Could not create property: ${propertyError?.message}`);

    const { data: listing, error: listingError } = await supabaseAdmin
      .from('listings')
      .insert({
        tenant_id: a.tenantId,
        property_id: property.id,
        agent_id: a.userId,
        listing_type: 'sale',
        price: 5000000,
        status: 'active',
      })
      .select('id')
      .single();
    if (listingError || !listing) throw new Error(`Could not create listing: ${listingError?.message}`);
    listingId = listing.id;
  }

  console.log('\n--- Brokerage A (sharer) ---');
  console.log(`Login: ${BROKERAGE_A.email} / ${BROKERAGE_A.password}`);
  console.log(`Has an active listing ready to "Share as docket" (listing ${listingId}).`);
  console.log('\n--- Brokerage B (recipient) ---');
  console.log(`Login: ${BROKERAGE_B.email} / ${BROKERAGE_B.password}`);
  console.log(`Share to handle: @${b.handle}`);
  console.log('\nFlow: sign in as A -> open the listing -> "Share as docket" -> enter the');
  console.log(`handle @${b.handle} -> sign in as B (separate browser/incognito) -> "Shared with me".`);
}

main();
