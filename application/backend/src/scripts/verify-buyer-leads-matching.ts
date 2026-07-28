import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-buyer-leads-matching-001 DoD verification. Creates two throwaway
// workspaces/users (sharer + recipient), mirroring
// verify-rls-docket-cross-tenant.ts's pattern, so the docket-search DoD items
// can actually be exercised end-to-end (own-inventory-only accounts can't
// prove those). Deletes everything it created.
// Run via (from application/backend, with `npx tsx src/index.ts` already
// running in another terminal):
// npx tsx src/scripts/verify-buyer-leads-matching.ts
const BACKEND_URL = process.env.BACKEND_VERIFY_URL ?? 'http://localhost:4000';
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

async function createWorkspaceAndUser(label: string, email: string, password: string, handle: string) {
  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({ name: `Matching Verify ${label}`, contract_start_date: '2026-01-01', contract_end_date: '2027-01-01' })
    .select('id')
    .single();
  if (workspaceError || !workspace) throw new Error(`workspace: ${workspaceError?.message}`);

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { tenant_id: workspace.id },
  });
  if (userError || !userData.user) throw new Error(`user: ${userError?.message}`);

  const { error: handleError } = await supabaseAdmin.from('profiles').update({ handle }).eq('id', userData.user.id);
  if (handleError) throw new Error(`handle: ${handleError.message}`);

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', userData.user.id).single();

  return { tenantId: workspace.id as string, userId: userData.user.id as string, role: profile!.role as string };
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
  const sharerEmail = `danielbacud+matching-sharer-${suffix}@gmail.com`;
  const recipientEmail = `danielbacud+matching-recipient-${suffix}@gmail.com`;
  const password = 'MatchingVerify123!';

  const sharer = await createWorkspaceAndUser('Sharer', sharerEmail, password, `matchsharer${suffix}`);
  const recipient = await createWorkspaceAndUser('Recipient', recipientEmail, password, `matchrecip${suffix}`);
  console.log(`sharer.role=${sharer.role} recipient.role=${recipient.role}`);

  const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);

  async function tokenFor(email: string): Promise<string> {
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new Error(`sign-in ${email}: ${error?.message}`);
    return data.session.access_token;
  }

  async function call(token: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
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

  const sharerToken = await tokenFor(sharerEmail);
  const recipientToken = await tokenFor(recipientEmail);

  let sharerListingId: string | undefined;
  let recipientOwnListingId: string | undefined;
  let docketId: string | undefined;
  let leadId: string | undefined;

  try {
    console.log('\n--- Setup: sharer creates an active listing, shares a partial docket (no budget) with recipient ---');
    const sharerProp = await call(sharerToken, '/properties', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Docket Match Property',
        type: 'condo_unit',
        owner_type: 'individual',
        city: 'Makati',
        province: 'Metro Manila',
        bedrooms: 2,
        bathrooms: 2,
      }),
    });
    if (sharerProp.status !== 201) throw new Error(`FAIL setup: sharer property: ${JSON.stringify(sharerProp.body)}`);

    const sharerListing = await call(sharerToken, '/listings', {
      method: 'POST',
      body: JSON.stringify({
        property_id: sharerProp.body.id,
        listing_type: 'sale',
        price: 3000000,
        authority_starts_at: new Date().toISOString().slice(0, 10),
      }),
    });
    if (sharerListing.status !== 201) throw new Error(`FAIL setup: sharer listing: ${JSON.stringify(sharerListing.body)}`);
    sharerListingId = sharerListing.body.id;
    await call(sharerToken, `/listings/${sharerListingId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });

    // Deliberately omit price/price_currency -- proves the "missing field
    // excluded from weighted average, not scored as 0" DoD item.
    const docketRes = await call(sharerToken, '/listing-dockets', {
      method: 'POST',
      body: JSON.stringify({
        listing_id: sharerListingId,
        handle: `matchrecip${suffix}`,
        included_fields: ['listing_type', 'status', 'type', 'city', 'province', 'bedrooms', 'bathrooms'],
      }),
    });
    if (docketRes.status !== 201) throw new Error(`FAIL setup: create docket: ${JSON.stringify(docketRes.body)}`);
    docketId = docketRes.body.id;
    console.log(`sharerListing=${sharerListingId} docket=${docketId}`);

    console.log('\n--- Setup: recipient creates their own active listing (non-matching city, to prove ranking) ---');
    const recipientProp = await call(recipientToken, '/properties', {
      method: 'POST',
      body: JSON.stringify({ title: 'Own Inventory Property', type: 'condo_unit', owner_type: 'individual', city: 'Cebu City' }),
    });
    if (recipientProp.status !== 201) throw new Error(`FAIL setup: recipient property: ${JSON.stringify(recipientProp.body)}`);
    const recipientListing = await call(recipientToken, '/listings', {
      method: 'POST',
      body: JSON.stringify({
        property_id: recipientProp.body.id,
        listing_type: 'sale',
        price: 3000000,
        authority_starts_at: new Date().toISOString().slice(0, 10),
      }),
    });
    if (recipientListing.status !== 201) throw new Error(`FAIL setup: recipient listing: ${JSON.stringify(recipientListing.body)}`);
    recipientOwnListingId = recipientListing.body.id;
    await call(recipientToken, `/listings/${recipientOwnListingId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });

    console.log('\n--- 1. Recipient creates a Lead matching the docket (buy, condo_unit, Makati, budget covers 3M) ---');
    const leadRes = await call(recipientToken, '/buyer-requirements', {
      method: 'POST',
      body: JSON.stringify({
        create_contact: { name: 'Matching Verify Buyer' },
        intent: 'buy',
        property_type: 'condo_unit',
        budget_min: 2000000,
        budget_max: 4000000,
        target_city: 'Makati',
        bedrooms: 2,
        bathrooms: 2,
      }),
    });
    if (leadRes.status !== 201) throw new Error(`FAIL: create lead: ${JSON.stringify(leadRes.body)}`);
    leadId = leadRes.body.id;
    if (leadRes.body.stage !== 'registered') throw new Error('FAIL: new lead should start registered');
    console.log(`lead=${leadId}`);

    console.log('\n--- 2. POST /buyer-requirements/:id/search (no hard filters) returns both sources, docket budget excluded not zeroed ---');
    const search1 = await call(recipientToken, `/buyer-requirements/${leadId}/search`, {
      method: 'POST',
      body: JSON.stringify({ hard_filter_fields: [] }),
    });
    if (search1.status !== 200) throw new Error(`FAIL: search: ${JSON.stringify(search1.body)}`);
    const results1 = search1.body.results as any[];
    const docketResult = results1.find((r) => r.source === 'docket');
    const inventoryResult = results1.find((r) => r.source === 'inventory');
    if (!docketResult) throw new Error(`FAIL: docket result missing from search: ${JSON.stringify(results1)}`);
    if (!inventoryResult) throw new Error(`FAIL: inventory result missing from search: ${JSON.stringify(results1)}`);
    if (docketResult.shared_by_handle !== `matchsharer${suffix}`) throw new Error('FAIL: docket result missing sharer handle');
    // Docket omitted price -- budget must be excluded from scoring, not
    // treated as a 0. Since city/bedrooms/bathrooms/property_type all match,
    // the docket's score should clearly beat the recipient's own
    // wrong-city listing.
    if (!(docketResult.score > inventoryResult.score)) {
      throw new Error(`FAIL: expected docket (matches) to outscore own wrong-city inventory. docket=${docketResult.score} inventory=${inventoryResult.score}`);
    }
    if (docketResult.excluded_fields.includes('budget')) {
      throw new Error('FAIL: budget should be dropped from scoring (missing data), not scored low/excluded-as-mismatch');
    }
    console.log(`docket score=${docketResult.score} matched=${docketResult.matched_fields} inventory score=${inventoryResult.score}`);
    console.log('PASS');

    console.log('\n--- 3. last_searched_at set, stage bumped registered -> searching ---');
    const leadAfter = await call(recipientToken, `/buyer-requirements/${leadId}`);
    if (!leadAfter.body.last_searched_at) throw new Error('FAIL: last_searched_at not set');
    if (leadAfter.body.stage !== 'searching') throw new Error(`FAIL: expected stage=searching, got ${leadAfter.body.stage}`);
    console.log('PASS');

    console.log('\n--- 4. Hard filter on property_type excludes a mismatch entirely (not just lowers score) ---');
    const leadOther = await call(recipientToken, '/buyer-requirements', {
      method: 'POST',
      body: JSON.stringify({ create_contact: { name: 'Wrong Type Buyer' }, intent: 'buy', property_type: 'house_and_lot' }),
    });
    const search2 = await call(recipientToken, `/buyer-requirements/${leadOther.body.id}/search`, {
      method: 'POST',
      body: JSON.stringify({ hard_filter_fields: ['property_type'] }),
    });
    const results2 = search2.body.results as any[];
    if (results2.some((r) => r.listing_id === sharerListingId || r.listing_id === recipientOwnListingId)) {
      throw new Error('FAIL: property_type hard filter should have excluded both condo_unit listings');
    }
    console.log('PASS');

    console.log('\n--- 5. Intent hard filter: lease requirement excludes sale-only listings entirely ---');
    const leadLease = await call(recipientToken, '/buyer-requirements', {
      method: 'POST',
      body: JSON.stringify({ create_contact: { name: 'Lease Buyer' }, intent: 'lease' }),
    });
    const search3 = await call(recipientToken, `/buyer-requirements/${leadLease.body.id}/search`, {
      method: 'POST',
      body: JSON.stringify({ hard_filter_fields: [] }),
    });
    const results3 = search3.body.results as any[];
    if (results3.some((r) => r.listing_id === sharerListingId || r.listing_id === recipientOwnListingId)) {
      throw new Error('FAIL: intent=lease should always exclude sale listings, no toggle needed');
    }
    console.log('PASS');

    console.log('\n--- 6. Send docket-sourced match as an option (options-sent accepts a shared, active docket listing) ---');
    const sendRes = await call(recipientToken, `/buyer-requirements/${leadId}/options-sent`, {
      method: 'POST',
      body: JSON.stringify({ listing_ids: [sharerListingId], scores: { [sharerListingId!]: docketResult.score } }),
    });
    if (sendRes.status !== 201) throw new Error(`FAIL: options-sent for docket listing: ${JSON.stringify(sendRes.body)}`);
    console.log('PASS');

    console.log('\n--- 6b. Birds-eye audit fix (2026-07-28): sent score is persisted, matches the search result ---');
    const leadWithMatches = await call(recipientToken, `/buyer-requirements/${leadId}`);
    const persistedMatch = (leadWithMatches.body.buyer_requirement_matches as any[]).find(
      (m) => m.listing_id === sharerListingId,
    );
    if (!persistedMatch) throw new Error('FAIL: sent match not found on lead');
    if (persistedMatch.score !== docketResult.score) {
      throw new Error(`FAIL: expected persisted score=${docketResult.score}, got ${persistedMatch.score}`);
    }
    console.log(`PASS (persisted score=${persistedMatch.score})`);

    console.log('\n--- 6c. Plain unranked send (no scores param, mirrors LeadDetailPanel) still stores null ---');
    const unrankedLead = await call(recipientToken, '/buyer-requirements', {
      method: 'POST',
      body: JSON.stringify({ create_contact: { name: 'Unranked Send Buyer' }, intent: 'buy' }),
    });
    const unrankedSend = await call(recipientToken, `/buyer-requirements/${unrankedLead.body.id}/options-sent`, {
      method: 'POST',
      body: JSON.stringify({ listing_ids: [recipientOwnListingId] }),
    });
    if (unrankedSend.status !== 201) throw new Error(`FAIL: unranked options-sent: ${JSON.stringify(unrankedSend.body)}`);
    const unrankedLeadAfter = await call(recipientToken, `/buyer-requirements/${unrankedLead.body.id}`);
    const unrankedMatch = (unrankedLeadAfter.body.buyer_requirement_matches as any[]).find(
      (m) => m.listing_id === recipientOwnListingId,
    );
    if (!unrankedMatch || unrankedMatch.score !== null) {
      throw new Error(`FAIL: expected null score with no scores param, got ${JSON.stringify(unrankedMatch)}`);
    }
    console.log('PASS (score stayed null)');

    console.log('\n--- 7. Revoke the docket -> it stops appearing in search ---');
    const revoke = await call(sharerToken, `/listing-dockets/${docketId}`, { method: 'PATCH', body: JSON.stringify({ status: 'revoked' }) });
    if (revoke.status !== 200) throw new Error(`FAIL: revoke docket: ${JSON.stringify(revoke.body)}`);
    const search4 = await call(recipientToken, `/buyer-requirements/${leadId}/search`, {
      method: 'POST',
      body: JSON.stringify({ hard_filter_fields: [] }),
    });
    const results4 = search4.body.results as any[];
    if (results4.some((r) => r.source === 'docket')) throw new Error('FAIL: revoked docket should not appear in search');
    console.log('PASS');

    console.log('\n--- 8. GET/PATCH /settings/matching ---');
    const settingsGet = await call(recipientToken, '/settings/matching');
    if (settingsGet.status !== 200 || settingsGet.body.match_score_threshold !== 50) {
      throw new Error(`FAIL: expected default threshold 50, got ${JSON.stringify(settingsGet.body)}`);
    }
    if (recipient.role === 'admin') {
      const settingsPatch = await call(recipientToken, '/settings/matching', {
        method: 'PATCH',
        body: JSON.stringify({ match_score_threshold: 65 }),
      });
      if (settingsPatch.status !== 200 || settingsPatch.body.match_score_threshold !== 65) {
        throw new Error(`FAIL: admin PATCH settings: ${JSON.stringify(settingsPatch.body)}`);
      }
      console.log('PASS (admin PATCH succeeded)');
    } else {
      const settingsPatch = await call(recipientToken, '/settings/matching', {
        method: 'PATCH',
        body: JSON.stringify({ match_score_threshold: 65 }),
      });
      if (settingsPatch.status !== 403) throw new Error(`FAIL: expected 403 for non-admin, got ${settingsPatch.status}`);
      console.log('PASS (non-admin correctly rejected with 403)');
    }

    console.log('\n=== ALL DOD CHECKS PASSED ===');
  } finally {
    console.log('\n--- Cleanup ---');
    await cleanup([sharer.tenantId, recipient.tenantId], [sharer.userId, recipient.userId]);
    console.log('Cleaned up.');
  }
}

main().catch((err) => {
  console.error('\n=== VERIFICATION FAILED ===');
  console.error(err);
  process.exit(1);
});
