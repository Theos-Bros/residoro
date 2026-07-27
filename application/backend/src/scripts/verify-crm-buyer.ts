import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-crm-buyer-001 DoD verification: listings.buyer_contact_id is required exactly on the
// transition to status='sold', rejected on every other transition, tenant-scoped, and
// surfaced correctly on GET /listings. Run via (from application/backend):
// npx tsx src/scripts/verify-crm-buyer.ts
const EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL;
const PASSWORD = process.env.MOBILE_TEST_ACCOUNT_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;

async function main() {
  if (!EMAIL || !PASSWORD || !SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error('Set MOBILE_TEST_ACCOUNT_EMAIL/PASSWORD, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY in .env first.');
    process.exit(1);
  }

  const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signInError || !signIn.session) {
    console.error('Could not sign in as the test account:', signInError?.message);
    process.exit(1);
  }
  const token = signIn.session.access_token;
  console.log(`Signed in as ${EMAIL}`);

  const { data: profile } = await supabaseAdmin.from('profiles').select('tenant_id, role').eq('id', signIn.user!.id).single();
  const tenantId = profile!.tenant_id;
  console.log(`tenant_id=${tenantId} role=${profile!.role}`);

  async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
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

  let propertyId: string | undefined;
  let listingId: string | undefined;
  let buyerId: string | undefined;
  let otherTenantContactId: string | undefined;

  try {
    console.log('\n--- Setup: create a property, a listing (draft), and a buyer contact ---');
    const propRes = await call('/properties', {
      method: 'POST',
      body: JSON.stringify({ title: 'Verify-CRM-Buyer Property', type: 'condo_unit', owner_type: 'individual' }),
    });
    if (propRes.status !== 201) throw new Error(`FAIL setup: could not create property: ${JSON.stringify(propRes.body)}`);
    propertyId = propRes.body.id;

    const listingRes = await call('/listings', {
      method: 'POST',
      body: JSON.stringify({
        property_id: propertyId,
        listing_type: 'sale',
        price: 2000000,
        exclusivity: 'exclusive',
        authority_starts_at: new Date().toISOString().slice(0, 10),
      }),
    });
    if (listingRes.status !== 201) throw new Error(`FAIL setup: could not create listing: ${JSON.stringify(listingRes.body)}`);
    listingId = listingRes.body.id;

    const { data: buyerContact, error: buyerErr } = await supabaseAdmin
      .from('contacts')
      .insert({ tenant_id: tenantId, name: 'Verify-CRM Buyer', type: 'buyer_lead', created_by: signIn.user!.id })
      .select('id')
      .single();
    if (buyerErr || !buyerContact) throw new Error(`FAIL setup: could not create buyer contact: ${buyerErr?.message}`);
    buyerId = buyerContact.id;
    console.log(`property=${propertyId} listing=${listingId} buyer=${buyerId}`);

    console.log('\n--- 1. draft -> active without buyer_contact_id succeeds (unaffected by this feature) ---');
    const toActive = await call(`/listings/${listingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    });
    console.log(toActive);
    if (toActive.status !== 200) throw new Error('FAIL: draft -> active should still succeed unchanged');
    console.log('PASS');

    console.log('\n--- 2. active -> under_offer with a buyer_contact_id present -> 400 (not sold yet) ---');
    const earlyBuyer = await call(`/listings/${listingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'under_offer', buyer_contact_id: buyerId }),
    });
    console.log(earlyBuyer);
    if (earlyBuyer.status !== 400) throw new Error('FAIL: buyer_contact_id on a non-sold transition should 400');
    console.log('PASS');

    console.log('\n--- 3. active -> under_offer without buyer_contact_id succeeds ---');
    const toUnderOffer = await call(`/listings/${listingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'under_offer' }),
    });
    console.log(toUnderOffer);
    if (toUnderOffer.status !== 200) throw new Error('FAIL: active -> under_offer should succeed');
    console.log('PASS');

    console.log('\n--- 4. under_offer -> sold WITHOUT buyer_contact_id -> 400 ---');
    const soldNoBuyer = await call(`/listings/${listingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'sold' }),
    });
    console.log(soldNoBuyer);
    if (soldNoBuyer.status !== 400) throw new Error('FAIL: sold without buyer_contact_id should 400');
    console.log('PASS');

    console.log('\n--- 5. under_offer -> sold with a buyer_contact_id from another tenant -> 404 ---');
    const { data: otherTenant } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .neq('id', tenantId)
      .limit(1)
      .single();
    if (otherTenant) {
      const { data: otherContact } = await supabaseAdmin
        .from('contacts')
        .insert({ tenant_id: otherTenant.id, name: 'Other Tenant Buyer', type: 'buyer_lead' })
        .select('id')
        .single();
      otherTenantContactId = otherContact?.id;
      if (otherTenantContactId) {
        const crossTenant = await call(`/listings/${listingId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'sold', buyer_contact_id: otherTenantContactId }),
        });
        console.log(crossTenant);
        if (crossTenant.status !== 404) throw new Error('FAIL: cross-tenant buyer_contact_id should 404');
        console.log('PASS');
      }
    } else {
      console.log('SKIP (no other tenant available to test cross-tenant rejection)');
    }

    console.log('\n--- 6. under_offer -> sold with a valid buyer_contact_id -> 200, buyer_contact_id set ---');
    const soldWithBuyer = await call(`/listings/${listingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'sold', buyer_contact_id: buyerId }),
    });
    console.log(soldWithBuyer);
    if (soldWithBuyer.status !== 200) throw new Error('FAIL: sold with a valid buyer_contact_id should 200');
    if (soldWithBuyer.body.buyer_contact_id !== buyerId) throw new Error('FAIL: response buyer_contact_id mismatch');
    console.log('PASS');

    console.log('\n--- 7. sold is terminal: no further transition is legal ---');
    const afterSold = await call(`/listings/${listingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    });
    console.log(afterSold);
    if (afterSold.status !== 400) throw new Error('FAIL: sold should be terminal, no transition out should succeed');
    console.log('PASS');

    console.log('\n--- 8. GET /listings surfaces buyer_contact_id/buyer_name for the sold listing ---');
    const list = await call('/listings');
    const row = list.body.listings.find((l: any) => l.id === listingId);
    console.log(row);
    if (!row) throw new Error('FAIL: listing missing from GET /listings');
    if (row.buyer_contact_id !== buyerId) throw new Error('FAIL: buyer_contact_id missing/wrong in GET /listings');
    if (row.buyer_name !== 'Verify-CRM Buyer') throw new Error(`FAIL: buyer_name expected 'Verify-CRM Buyer', got ${row.buyer_name}`);
    console.log('PASS');

    console.log('\n--- 9. A non-sold listing in the same list has buyer_contact_id/buyer_name = null ---');
    const otherListingRes = await call('/listings', {
      method: 'POST',
      body: JSON.stringify({
        property_id: propertyId,
        listing_type: 'sale',
        price: 1500000,
        authority_starts_at: new Date().toISOString().slice(0, 10),
      }),
    });
    if (otherListingRes.status !== 201) throw new Error('FAIL setup: could not create second listing');
    const list2 = await call('/listings');
    const draftRow = list2.body.listings.find((l: any) => l.id === otherListingRes.body.id);
    console.log(draftRow);
    if (draftRow.buyer_contact_id !== null || draftRow.buyer_name !== null) {
      throw new Error('FAIL: draft listing should have null buyer fields');
    }
    console.log('PASS');
    await supabaseAdmin.from('listings').delete().eq('id', otherListingRes.body.id);

    console.log('\nAll checks passed.');
  } finally {
    console.log('\n--- Cleanup ---');
    if (listingId) await supabaseAdmin.from('listings').delete().eq('id', listingId);
    if (propertyId) await supabaseAdmin.from('properties').delete().eq('id', propertyId);
    if (buyerId) await supabaseAdmin.from('contacts').delete().eq('id', buyerId);
    if (otherTenantContactId) await supabaseAdmin.from('contacts').delete().eq('id', otherTenantContactId);
    console.log('done');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
