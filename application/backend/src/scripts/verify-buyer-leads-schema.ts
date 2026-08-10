import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-buyer-leads-schema-001 DoD verification. Run via (from application/backend):
// npx tsx src/scripts/verify-buyer-leads-schema.ts
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
  let inquiryId: string | undefined;
  let leadId: string | undefined;
  let contactId: string | undefined;

  try {
    console.log('\n--- Setup: create an active listing to send as an option ---');
    const propRes = await call('/properties', {
      method: 'POST',
      body: JSON.stringify({ title: 'Verify-Buyer-Leads Property', type: 'condo_unit', owner_type: 'individual' }),
    });
    if (propRes.status !== 201) throw new Error(`FAIL setup: could not create property: ${JSON.stringify(propRes.body)}`);
    propertyId = propRes.body.id;

    const listingRes = await call('/listings', {
      method: 'POST',
      body: JSON.stringify({
        property_id: propertyId,
        listing_type: 'sale',
        price: 3000000,
        authority_starts_at: new Date().toISOString().slice(0, 10),
      }),
    });
    if (listingRes.status !== 201) throw new Error(`FAIL setup: could not create listing: ${JSON.stringify(listingRes.body)}`);
    listingId = listingRes.body.id;
    // Listings are created 'active' directly now (routes/listings.ts's
    // insert), so this redundant activate-PATCH became an illegal
    // active->active self-transition per STATUS_TRANSITIONS -- dropped.
    console.log(`property=${propertyId} listing=${listingId}`);

    console.log('\n--- 1. POST /inquiries defaults stage=to_probe regardless of client-sent stage ---');
    const createInquiry = await call('/inquiries', {
      method: 'POST',
      body: JSON.stringify({
        stage: 'qualified',
        buyer_name: 'Verify Buyer',
        buyer_phone: '+639171234567',
        intent: 'buy',
        property_type: 'condo_unit',
        budget_min: 2000000,
        budget_max: 4000000,
        target_city: 'Makati',
        bedrooms: 2,
      }),
    });
    console.log(createInquiry);
    if (createInquiry.status !== 201) throw new Error('FAIL: could not create inquiry');
    if (createInquiry.body.stage !== 'to_probe') throw new Error('FAIL: stage should default to_probe regardless of client input');
    inquiryId = createInquiry.body.id;
    console.log('PASS');

    console.log('\n--- 2. PATCH stage to probing, backward to to_probe (no transition graph) ---');
    const toProbing = await call(`/inquiries/${inquiryId}`, { method: 'PATCH', body: JSON.stringify({ stage: 'probing' }) });
    if (toProbing.status !== 200 || toProbing.body.stage !== 'probing') throw new Error('FAIL: could not move to probing');
    if (toProbing.body.probed_by !== signIn.user!.id) throw new Error('FAIL: probed_by should auto-set to caller');
    const backToProbe = await call(`/inquiries/${inquiryId}`, { method: 'PATCH', body: JSON.stringify({ stage: 'to_probe' }) });
    if (backToProbe.status !== 200 || backToProbe.body.stage !== 'to_probe') throw new Error('FAIL: backward transition should be legal');
    console.log('PASS');

    console.log('\n--- 3. POST /inquiries/:id/qualify creates a Lead with copied fields + a new contact ---');
    await call(`/inquiries/${inquiryId}`, { method: 'PATCH', body: JSON.stringify({ stage: 'probing' }) });
    const qualify = await call(`/inquiries/${inquiryId}/qualify`, {
      method: 'POST',
      body: JSON.stringify({ create_contact: { name: 'Verify Buyer', phone: '+639171234567' } }),
    });
    console.log(qualify);
    if (qualify.status !== 201) throw new Error('FAIL: qualify should succeed');
    if (qualify.body.inquiry.stage !== 'qualified' || !qualify.body.inquiry.promoted_lead_id) {
      throw new Error('FAIL: inquiry should be stage=qualified with promoted_lead_id set');
    }
    leadId = qualify.body.lead.id;
    contactId = qualify.body.lead.contact_id;
    if (qualify.body.lead.target_city !== 'Makati' || qualify.body.lead.bedrooms !== 2) {
      throw new Error('FAIL: requirement fields should be copied from the inquiry');
    }
    if (qualify.body.lead.stage !== 'registered') throw new Error('FAIL: new lead should start at stage=registered');
    console.log('PASS');

    console.log('\n--- 3b. Qualifying an inquiry with intent left unset defaults the Lead to intent=buy ---');
    const noIntentInquiry = await call('/inquiries', {
      method: 'POST',
      body: JSON.stringify({ buyer_name: 'No Intent Buyer', target_city: 'Cebu' }),
    });
    if (noIntentInquiry.status !== 201) throw new Error('FAIL setup: could not create no-intent inquiry');
    const noIntentQualify = await call(`/inquiries/${noIntentInquiry.body.id}/qualify`, {
      method: 'POST',
      body: JSON.stringify({ create_contact: { name: 'No Intent Buyer' } }),
    });
    console.log(noIntentQualify);
    if (noIntentQualify.status !== 201) throw new Error(`FAIL: qualifying an intent-less inquiry should still succeed (regression: NOT NULL violation on buyer_requirements.intent)`);
    if (noIntentQualify.body.lead.intent !== 'buy') throw new Error('FAIL: lead.intent should default to buy when the source inquiry never set one');
    console.log('PASS');
    // Clear the referencing side (inquiries.promoted_lead_id) before deleting
    // the row it points at -- same FK-ordering gotcha as the main cleanup
    // block below, easy to re-trip in an inline cleanup like this one.
    await supabaseAdmin.from('inquiries').update({ promoted_lead_id: null }).eq('id', noIntentInquiry.body.id);
    await supabaseAdmin.from('buyer_requirements').delete().eq('id', noIntentQualify.body.lead.id);
    await supabaseAdmin.from('inquiries').delete().eq('id', noIntentInquiry.body.id);
    await supabaseAdmin.from('contacts').delete().eq('id', noIntentQualify.body.lead.contact_id);

    console.log('\n--- 4. A second qualify call on the same (now-qualified) inquiry returns 409 ---');
    const reQualify = await call(`/inquiries/${inquiryId}/qualify`, {
      method: 'POST',
      body: JSON.stringify({ contact_id: contactId }),
    });
    console.log(reQualify);
    if (reQualify.status !== 409) throw new Error('FAIL: re-qualifying should 409');
    console.log('PASS');

    console.log('\n--- 5. PATCH /buyer-requirements/:id stage accepts any value, forward and backward ---');
    const toSearching = await call(`/buyer-requirements/${leadId}`, { method: 'PATCH', body: JSON.stringify({ stage: 'searching' }) });
    if (toSearching.status !== 200 || toSearching.body.stage !== 'searching') throw new Error('FAIL: could not move to searching');
    const toStalled = await call(`/buyer-requirements/${leadId}`, { method: 'PATCH', body: JSON.stringify({ stage: 'stalled' }) });
    if (toStalled.status !== 200) throw new Error('FAIL: could not move to stalled');
    const backToRegistered = await call(`/buyer-requirements/${leadId}`, { method: 'PATCH', body: JSON.stringify({ stage: 'registered' }) });
    if (backToRegistered.status !== 200 || backToRegistered.body.stage !== 'registered') {
      throw new Error('FAIL: backward transition (stalled -> registered) should be legal, no transition graph');
    }
    console.log('PASS');

    console.log('\n--- 6. POST /buyer-requirements/:id/options-sent rejects a non-active listing ---');
    // POST /listings now always creates status:'active' directly (no
    // draft-by-default path left in the app) -- forcing a non-active
    // fixture via supabaseAdmin is the only way left to set this test up,
    // same fixture-bypass precedent other verify scripts already use.
    const { data: draftListing, error: draftListingError } = await supabaseAdmin
      .from('listings')
      .insert({ tenant_id: tenantId, property_id: propertyId, agent_id: signIn.user!.id, listing_type: 'sale', price: 1000000, status: 'inactive' })
      .select('id')
      .single();
    if (draftListingError || !draftListing) throw new Error(`FAIL setup: could not create non-active listing fixture: ${draftListingError?.message}`);
    const draftListingId = draftListing.id;
    const rejectDraft = await call(`/buyer-requirements/${leadId}/options-sent`, {
      method: 'POST',
      body: JSON.stringify({ listing_ids: [draftListingId] }),
    });
    console.log(rejectDraft);
    if (rejectDraft.status !== 400) throw new Error('FAIL: non-active listing should be rejected with 400');
    console.log('PASS');
    await supabaseAdmin.from('listings').delete().eq('id', draftListingId);

    console.log('\n--- 7. POST /buyer-requirements/:id/options-sent succeeds for a real active listing ---');
    const optionsSent = await call(`/buyer-requirements/${leadId}/options-sent`, {
      method: 'POST',
      body: JSON.stringify({ listing_ids: [listingId] }),
    });
    console.log(optionsSent);
    if (optionsSent.status !== 201) throw new Error('FAIL: options-sent should succeed for a real active listing');
    if (optionsSent.body.buyer_requirement.stage !== 'options_sent') throw new Error('FAIL: stage should be options_sent');
    if (optionsSent.body.matches.length !== 1 || optionsSent.body.matches[0].score !== null) {
      throw new Error('FAIL: match should be created with score=null');
    }
    console.log('PASS');

    console.log('\n--- 8. PATCH mark-won rejects a listing not already sent as an option ---');
    const otherListingRes = await call('/listings', {
      method: 'POST',
      body: JSON.stringify({ property_id: propertyId, listing_type: 'sale', price: 1200000, authority_starts_at: new Date().toISOString().slice(0, 10) }),
    });
    const otherListingId = otherListingRes.body.id;
    await call(`/listings/${otherListingId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
    const rejectWon = await call(`/buyer-requirements/${leadId}/mark-won`, {
      method: 'PATCH',
      body: JSON.stringify({ listing_id: otherListingId }),
    });
    console.log(rejectWon);
    if (rejectWon.status !== 400) throw new Error('FAIL: marking won a listing never sent as an option should 400');
    console.log('PASS');
    await supabaseAdmin.from('listings').delete().eq('id', otherListingId);

    console.log('\n--- 9. PATCH mark-won succeeds and touches ONLY buyer_requirements, zero writes to listings ---');
    const { data: listingBefore } = await supabaseAdmin.from('listings').select('*').eq('id', listingId).single();
    const won = await call(`/buyer-requirements/${leadId}/mark-won`, {
      method: 'PATCH',
      body: JSON.stringify({ listing_id: listingId }),
    });
    console.log(won);
    if (won.status !== 200) throw new Error('FAIL: mark-won should succeed for a listing already sent as an option');
    if (won.body.stage !== 'won' || won.body.won_listing_id !== listingId) throw new Error('FAIL: won_listing_id/stage not set correctly');
    const { data: listingAfter } = await supabaseAdmin.from('listings').select('*').eq('id', listingId).single();
    if (JSON.stringify(listingBefore) !== JSON.stringify(listingAfter)) {
      throw new Error('FAIL: mark-won must not write to listings at all (buyer_contact_id, status, etc.)');
    }
    console.log('PASS -- listings row byte-for-byte unchanged');

    console.log('\n--- 10. Existing, unmodified sold flow: PATCH /listings/:id independently sets buyer_contact_id ---');
    await call(`/listings/${listingId}`, { method: 'PATCH', body: JSON.stringify({ status: 'under_offer' }) });
    const soldViaExistingFlow = await call(`/listings/${listingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'sold', buyer_contact_id: contactId }),
    });
    console.log(soldViaExistingFlow);
    if (soldViaExistingFlow.status !== 200 || soldViaExistingFlow.body.buyer_contact_id !== contactId) {
      throw new Error('FAIL: existing sold flow should still work entirely independently');
    }
    console.log('PASS');

    console.log('\nAll checks passed.');
  } finally {
    // Deletion order matters: inquiries.promoted_lead_id and
    // buyer_requirements.won_listing_id are plain FKs (no cascade) -- clear
    // the referencing side before deleting the referenced row, or the
    // Supabase JS client silently no-ops the delete (it returns an {error},
    // it doesn't throw) and leaves orphaned rows behind, as happened here
    // the first time this script ran.
    console.log('\n--- Cleanup ---');
    if (inquiryId) {
      const { error } = await supabaseAdmin.from('inquiries').update({ promoted_lead_id: null }).eq('id', inquiryId);
      if (error) console.error('cleanup: clear promoted_lead_id failed', error.message);
    }
    if (leadId) {
      const { error } = await supabaseAdmin.from('buyer_requirement_matches').delete().eq('buyer_requirement_id', leadId);
      if (error) console.error('cleanup: delete matches failed', error.message);
    }
    if (leadId) {
      const { error } = await supabaseAdmin.from('buyer_requirements').delete().eq('id', leadId);
      if (error) console.error('cleanup: delete buyer_requirements failed', error.message);
    }
    if (inquiryId) {
      const { error } = await supabaseAdmin.from('inquiries').delete().eq('id', inquiryId);
      if (error) console.error('cleanup: delete inquiry failed', error.message);
    }
    if (listingId) {
      const { error } = await supabaseAdmin.from('listings').delete().eq('id', listingId);
      if (error) console.error('cleanup: delete listing failed', error.message);
    }
    if (propertyId) {
      const { error } = await supabaseAdmin.from('properties').delete().eq('id', propertyId);
      if (error) console.error('cleanup: delete property failed', error.message);
    }
    if (contactId) {
      const { error } = await supabaseAdmin.from('contacts').delete().eq('id', contactId);
      if (error) console.error('cleanup: delete contact failed', error.message);
    }
    console.log('done');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
