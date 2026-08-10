import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-platform-rls-scoped-client-001 DoD verification, dockets.ts specifically:
// dockets.ts got a per-query split rather than a blanket route-wide swap
// (see the file-level comment in routes/dockets.ts) because
// GET /listing-dockets/received's nested listings/properties join is
// genuinely cross-tenant by design and would silently come back null under
// the scoped client. This script proves the split actually works end-to-end
// against the real running backend (http://localhost:4000): a real
// cross-tenant docket share still returns real field values, not nulls.
// Creates two throwaway workspaces/users, exercises the real HTTP routes,
// then deletes everything it created.
// Run via (from application/backend, with `npx tsx src/index.ts` already
// running in another terminal): npx tsx src/scripts/verify-rls-docket-cross-tenant.ts
const BACKEND_URL = process.env.BACKEND_VERIFY_URL ?? 'http://localhost:4000';
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

async function createWorkspaceAndUser(label: string, email: string, password: string, handle: string) {
  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({ name: `RLS Docket Verify ${label}`, contract_start_date: '2026-01-01', contract_end_date: '2027-01-01' })
    .select('id')
    .single();
  if (workspaceError || !workspace) throw new Error(`workspace: ${workspaceError?.message}`);

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !userData.user) throw new Error(`user: ${userError?.message}`);

  // handle_new_user() has ignored user_metadata entirely since Finding 1's
  // fix (2026-07-29, docs/security-review-2026-07-29.md) -- every signup
  // gets an inert profile now. Assign tenant_id/handle the same trusted way
  // every other verify script does, via a direct service-role update.
  const { error: handleError } = await supabaseAdmin
    .from('profiles')
    .update({ handle, tenant_id: workspace.id, role: 'member' })
    .eq('id', userData.user.id);
  if (handleError) throw new Error(`handle: ${handleError.message}`);

  return { tenantId: workspace.id as string, userId: userData.user.id as string };
}

async function cleanup(tenantIds: string[], userIds: string[]) {
  for (const id of userIds) await supabaseAdmin.auth.admin.deleteUser(id);
  for (const id of tenantIds) await supabaseAdmin.from('workspaces').delete().eq('id', id);
}

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env first.');
    process.exit(1);
  }

  const suffix = Date.now();
  const sharerEmail = `danielbacud+rls-docket-sharer-${suffix}@gmail.com`;
  const recipientEmail = `danielbacud+rls-docket-recipient-${suffix}@gmail.com`;
  const password = 'RlsDocketVerify123!';

  const sharer = await createWorkspaceAndUser('Sharer', sharerEmail, password, `rlssharer${suffix}`);
  const recipient = await createWorkspaceAndUser('Recipient', recipientEmail, password, `rlsrecip${suffix}`);
  const tenantIds = [sharer.tenantId, recipient.tenantId];
  const userIds = [sharer.userId, recipient.userId];

  try {
    const { data: property, error: propertyError } = await supabaseAdmin
      .from('properties')
      .insert({
        tenant_id: sharer.tenantId,
        created_by: sharer.userId,
        title: 'RLS Docket Verify Unit',
        type: 'condo_unit',
        owner_type: 'individual',
        city: 'Taguig',
        province: 'Metro Manila',
        price: 5000000,
      })
      .select('id')
      .single();
    if (propertyError || !property) throw new Error(`property: ${propertyError?.message}`);

    const { data: listing, error: listingError } = await supabaseAdmin
      .from('listings')
      .insert({
        tenant_id: sharer.tenantId,
        property_id: property.id,
        agent_id: sharer.userId,
        listing_type: 'sale',
        price: 5000000,
        status: 'active',
      })
      .select('id')
      .single();
    if (listingError || !listing) throw new Error(`listing: ${listingError?.message}`);

    const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const sharerSignIn = await anon.auth.signInWithPassword({ email: sharerEmail, password });
    if (sharerSignIn.error || !sharerSignIn.data.session) throw new Error(`sharer sign-in: ${sharerSignIn.error?.message}`);
    const sharerToken = sharerSignIn.data.session.access_token;

    const recipientAnon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const recipientSignIn = await recipientAnon.auth.signInWithPassword({ email: recipientEmail, password });
    if (recipientSignIn.error || !recipientSignIn.data.session)
      throw new Error(`recipient sign-in: ${recipientSignIn.error?.message}`);
    const recipientToken = recipientSignIn.data.session.access_token;

    const shareRes = await fetch(`${BACKEND_URL}/listing-dockets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sharerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listing_id: listing.id,
        handle: `rlsrecip${suffix}`,
        included_fields: ['price', 'city', 'title'],
      }),
    });
    console.log('POST /listing-dockets ->', shareRes.status);
    if (shareRes.status !== 201) {
      console.error(await shareRes.text());
      throw new Error('docket share failed');
    }

    const receivedRes = await fetch(`${BACKEND_URL}/listing-dockets/received`, {
      headers: { Authorization: `Bearer ${recipientToken}` },
    });
    const received = (await receivedRes.json()) as {
      dockets?: Array<{ fields?: Record<string, unknown>; shared_by_handle?: string }>;
    };
    console.log('GET /listing-dockets/received ->', receivedRes.status);
    console.log(JSON.stringify(received, null, 2));

    const docket = received.dockets?.[0];
    if (!docket) throw new Error('FAIL: no docket in recipient inbox');

    const hasRealFields =
      docket.fields?.price === 5000000 && docket.fields?.city === 'Taguig' && docket.shared_by_handle === `rlssharer${suffix}`;

    if (!hasRealFields) {
      console.error('\nFAIL: docket fields came back null/wrong -- the cross-tenant join split broke the feature.');
      process.exit(1);
    }
    console.log('\nPASS: cross-tenant docket share still returns real, live-projected field values.');
  } finally {
    await cleanup(tenantIds, userIds);
    console.log('Cleaned up throwaway workspaces/users.');
  }
}

main();
