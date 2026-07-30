import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-buyer-leads-revisit-page-001 DoD verification. Uses the existing
// MOBILE_TEST_ACCOUNT_* throwaway-but-persistent test account (same account
// verify-buyer-leads-stage-tasks.ts signs in as), rather than spinning up a
// fresh workspace -- this feature has no cross-tenant behavior to prove, so
// the lighter-weight "reuse an existing tenant, delete only what this script
// created" pattern applies (properties/listings/contacts/leads only; the
// workspace/user themselves are never touched).
//
// Covers: mark-won 400s without lease_end_date on a rent-type win, succeeds
// with it (Expired/Expiring Soon/Active date buckets all exercised), a
// sale-type win never requires it (and any lease_end_date sent alongside a
// sale-type win is silently dropped, per the tracer bullet's chosen
// leniency), and GET /buyer-requirements/revisit returns exactly the
// non-null-lease_end_date won leads, sorted soonest-first, with the
// listing/property/contact joins populated.
//
// Run via (from application/backend, with `npx tsx src/index.ts` already
// running in another terminal):
// npx tsx src/scripts/verify-buyer-leads-revisit-page.ts
const EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL;
const PASSWORD = process.env.MOBILE_TEST_ACCOUNT_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

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
  const userId = signIn.user!.id;
  const { data: profile } = await supabaseAdmin.from('profiles').select('tenant_id, role').eq('id', userId).single();
  const tenantId = profile!.tenant_id;
  console.log(`Signed in as ${EMAIL} (tenant_id=${tenantId}, role=${profile!.role})`);

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

  const suffix = Date.now();
  const propertyIds: string[] = [];
  const listingIds: string[] = [];
  const leadIds: string[] = [];
  const contactIds: string[] = [];

  try {
    console.log('\n--- Setup: one active rent-type listing, one active sale-type listing ---');
    const rentProp = await call('/properties', {
      method: 'POST',
      body: JSON.stringify({ title: `Revisit Verify Rent Property ${suffix}`, type: 'condo_unit', owner_type: 'individual', city: 'Taguig', province: 'Metro Manila' }),
    });
    if (rentProp.status !== 201) throw new Error(`FAIL setup: rent property: ${JSON.stringify(rentProp.body)}`);
    propertyIds.push(rentProp.body.id);

    const rentListing = await call('/listings', {
      method: 'POST',
      body: JSON.stringify({ property_id: rentProp.body.id, listing_type: 'rent', price: 45000, authority_starts_at: daysFromNow(0) }),
    });
    if (rentListing.status !== 201) throw new Error(`FAIL setup: rent listing: ${JSON.stringify(rentListing.body)}`);
    const rentListingId = rentListing.body.id as string;
    listingIds.push(rentListingId);
    const rentActivate = await call(`/listings/${rentListingId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
    if (rentActivate.status !== 200) throw new Error(`FAIL setup: activate rent listing: ${JSON.stringify(rentActivate.body)}`);

    const saleProp = await call('/properties', {
      method: 'POST',
      body: JSON.stringify({ title: `Revisit Verify Sale Property ${suffix}`, type: 'condo_unit', owner_type: 'individual', city: 'Taguig', province: 'Metro Manila' }),
    });
    if (saleProp.status !== 201) throw new Error(`FAIL setup: sale property: ${JSON.stringify(saleProp.body)}`);
    propertyIds.push(saleProp.body.id);

    const saleListing = await call('/listings', {
      method: 'POST',
      body: JSON.stringify({ property_id: saleProp.body.id, listing_type: 'sale', price: 3500000, authority_starts_at: daysFromNow(0) }),
    });
    if (saleListing.status !== 201) throw new Error(`FAIL setup: sale listing: ${JSON.stringify(saleListing.body)}`);
    const saleListingId = saleListing.body.id as string;
    listingIds.push(saleListingId);
    const saleActivate = await call(`/listings/${saleListingId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
    if (saleActivate.status !== 200) throw new Error(`FAIL setup: activate sale listing: ${JSON.stringify(saleActivate.body)}`);

    console.log('PASS (setup)');

    async function newLead(label: string, listingId: string): Promise<string> {
      const leadRes = await call('/buyer-requirements', {
        method: 'POST',
        body: JSON.stringify({ create_contact: { name: `Revisit Verify ${label} ${suffix}` }, intent: 'buy' }),
      });
      if (leadRes.status !== 201) throw new Error(`FAIL setup: create lead ${label}: ${JSON.stringify(leadRes.body)}`);
      const leadId = leadRes.body.id as string;
      leadIds.push(leadId);
      contactIds.push(leadRes.body.contact_id);

      const optionsRes = await call(`/buyer-requirements/${leadId}/options-sent`, {
        method: 'POST',
        body: JSON.stringify({ listing_ids: [listingId] }),
      });
      if (optionsRes.status !== 201) throw new Error(`FAIL setup: options-sent for ${label}: ${JSON.stringify(optionsRes.body)}`);
      return leadId;
    }

    console.log('\n--- 1. mark-won on a rent-type listing without lease_end_date -> 400 ---');
    const l1 = await newLead('Expired', rentListingId);
    const rentNoDate = await call(`/buyer-requirements/${l1}/mark-won`, {
      method: 'PATCH',
      body: JSON.stringify({ listing_id: rentListingId }),
    });
    if (rentNoDate.status !== 400) throw new Error(`FAIL: expected 400, got ${rentNoDate.status}: ${JSON.stringify(rentNoDate.body)}`);
    console.log(`PASS (400: ${rentNoDate.body.error})`);

    console.log('\n--- 2. mark-won on rent-type listing WITH lease_end_date (Expired bucket, -10 days) succeeds ---');
    const expiredDate = daysFromNow(-10);
    const l1Won = await call(`/buyer-requirements/${l1}/mark-won`, {
      method: 'PATCH',
      body: JSON.stringify({ listing_id: rentListingId, lease_end_date: expiredDate }),
    });
    if (l1Won.status !== 200 || l1Won.body.lease_end_date !== expiredDate) {
      throw new Error(`FAIL: expected 200 with lease_end_date=${expiredDate}, got ${JSON.stringify(l1Won.body)}`);
    }
    console.log(`PASS (lease_end_date=${l1Won.body.lease_end_date})`);

    console.log('\n--- 3. mark-won, rent-type, Expiring Soon bucket (+15 days) ---');
    const l2 = await newLead('ExpiringSoon', rentListingId);
    const soonDate = daysFromNow(15);
    const l2Won = await call(`/buyer-requirements/${l2}/mark-won`, {
      method: 'PATCH',
      body: JSON.stringify({ listing_id: rentListingId, lease_end_date: soonDate }),
    });
    if (l2Won.status !== 200 || l2Won.body.lease_end_date !== soonDate) {
      throw new Error(`FAIL: expected 200 with lease_end_date=${soonDate}, got ${JSON.stringify(l2Won.body)}`);
    }
    console.log(`PASS (lease_end_date=${l2Won.body.lease_end_date})`);

    console.log('\n--- 4. mark-won, rent-type, Active bucket (+90 days) ---');
    const l3 = await newLead('Active', rentListingId);
    const activeDate = daysFromNow(90);
    const l3Won = await call(`/buyer-requirements/${l3}/mark-won`, {
      method: 'PATCH',
      body: JSON.stringify({ listing_id: rentListingId, lease_end_date: activeDate }),
    });
    if (l3Won.status !== 200 || l3Won.body.lease_end_date !== activeDate) {
      throw new Error(`FAIL: expected 200 with lease_end_date=${activeDate}, got ${JSON.stringify(l3Won.body)}`);
    }
    console.log(`PASS (lease_end_date=${l3Won.body.lease_end_date})`);

    console.log('\n--- 5. mark-won on a sale-type listing WITHOUT lease_end_date succeeds, stays null ---');
    const l4 = await newLead('SaleNoDate', saleListingId);
    const l4Won = await call(`/buyer-requirements/${l4}/mark-won`, {
      method: 'PATCH',
      body: JSON.stringify({ listing_id: saleListingId }),
    });
    if (l4Won.status !== 200 || l4Won.body.lease_end_date !== null) {
      throw new Error(`FAIL: expected 200 with lease_end_date=null, got ${JSON.stringify(l4Won.body)}`);
    }
    console.log('PASS (lease_end_date stayed null for a sale-type win)');

    console.log('\n--- 6. mark-won on a sale-type listing WITH lease_end_date sent anyway -> accepted but ignored (silently nulled) ---');
    const l5 = await newLead('SaleWithDate', saleListingId);
    const l5Won = await call(`/buyer-requirements/${l5}/mark-won`, {
      method: 'PATCH',
      body: JSON.stringify({ listing_id: saleListingId, lease_end_date: daysFromNow(5) }),
    });
    if (l5Won.status !== 200 || l5Won.body.lease_end_date !== null) {
      throw new Error(`FAIL: expected 200 with lease_end_date silently nulled, got ${JSON.stringify(l5Won.body)}`);
    }
    console.log('PASS (sale-type win ignored the sent lease_end_date, left it null)');

    console.log('\n--- 7. GET /buyer-requirements/revisit: exactly the 3 rent-type wins, sorted soonest-first ---');
    const revisit = await call('/buyer-requirements/revisit');
    if (revisit.status !== 200) throw new Error(`FAIL: GET revisit: ${JSON.stringify(revisit.body)}`);
    const rows = revisit.body.revisit_leads as any[];
    const ours = rows.filter((r) => [l1, l2, l3, l4, l5].includes(r.id));
    if (ours.length !== 3) {
      throw new Error(`FAIL: expected exactly 3 of our leads (the rent-type wins) in revisit, got ${ours.length}: ${JSON.stringify(ours)}`);
    }
    if (ours.some((r) => r.id === l4 || r.id === l5)) {
      throw new Error('FAIL: a sale-type win (null lease_end_date) leaked into the revisit list');
    }
    const ourIdsInOrder = ours.map((r) => r.id);
    if (JSON.stringify(ourIdsInOrder) !== JSON.stringify([l1, l2, l3])) {
      throw new Error(`FAIL: expected order [expired, soon, active] = [${l1}, ${l2}, ${l3}], got ${JSON.stringify(ourIdsInOrder)}`);
    }
    console.log('PASS (exactly the 3 rent-type wins, ascending by lease_end_date)');

    console.log('\n--- 8. Revisit rows carry contact name + listing/property joins, and client-side bucket math lands correctly ---');
    function bucketFor(dateStr: string): 'expired' | 'expiring_soon' | 'active' {
      const days = Math.round((new Date(dateStr).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
      if (days < 0) return 'expired';
      if (days <= 30) return 'expiring_soon';
      return 'active';
    }
    const byId = new Map(ours.map((r) => [r.id, r]));
    const checks: [string, 'expired' | 'expiring_soon' | 'active'][] = [
      [l1, 'expired'],
      [l2, 'expiring_soon'],
      [l3, 'active'],
    ];
    for (const [id, expectedBucket] of checks) {
      const row = byId.get(id);
      if (!row) throw new Error(`FAIL: lead ${id} missing from revisit rows`);
      if (!row.contacts?.name) throw new Error(`FAIL: lead ${id} missing contacts.name join: ${JSON.stringify(row)}`);
      if (row.listing?.listing_type !== 'rent') throw new Error(`FAIL: lead ${id} listing.listing_type not 'rent': ${JSON.stringify(row)}`);
      if (!row.listing?.properties?.title) throw new Error(`FAIL: lead ${id} missing listing.properties.title join: ${JSON.stringify(row)}`);
      const actualBucket = bucketFor(row.lease_end_date);
      if (actualBucket !== expectedBucket) {
        throw new Error(`FAIL: lead ${id} (lease_end_date=${row.lease_end_date}) expected bucket ${expectedBucket}, computed ${actualBucket}`);
      }
    }
    console.log('PASS (joins present, buckets: expired/expiring_soon/active all correct)');

    console.log('\n=== ALL DOD CHECKS PASSED ===');
  } finally {
    console.log('\n--- Cleanup ---');
    for (const id of leadIds) {
      const { error } = await supabaseAdmin.from('buyer_requirements').delete().eq('id', id);
      if (error) throw new Error(`cleanup: delete lead ${id}: ${error.message}`);
    }
    for (const id of listingIds) {
      const { error } = await supabaseAdmin.from('listings').delete().eq('id', id);
      if (error) throw new Error(`cleanup: delete listing ${id}: ${error.message}`);
    }
    for (const id of propertyIds) {
      const { error } = await supabaseAdmin.from('properties').delete().eq('id', id);
      if (error) throw new Error(`cleanup: delete property ${id}: ${error.message}`);
    }
    for (const id of contactIds) {
      const { error } = await supabaseAdmin.from('contacts').delete().eq('id', id);
      if (error) throw new Error(`cleanup: delete contact ${id}: ${error.message}`);
    }
    console.log(
      `Cleaned up ${leadIds.length} leads, ${listingIds.length} listings, ${propertyIds.length} properties, ${contactIds.length} contacts.`,
    );
  }
}

main().catch((err) => {
  console.error('\n=== VERIFICATION FAILED ===');
  console.error(err);
  process.exit(1);
});
