import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-buyer-leads-broadcast-001 DoD verification. Single-tenant (unlike TB2's
// matching verify, this tracer bullet is never cross-tenant) -- reuses the
// existing MOBILE_TEST_ACCOUNT_* pattern from verify-buyer-leads-schema.ts.
// Restores the tenant's original buyer_wanted_share_template afterward so
// this script leaves no residue on a real account. Run via (from
// application/backend, with `npx tsx src/index.ts` already running in
// another terminal):
// npx tsx src/scripts/verify-buyer-leads-broadcast.ts
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

  let inquiryId: string | undefined;
  let leadId: string | undefined;
  let contactId: string | undefined;
  let originalTemplate: string | null | undefined;

  try {
    console.log('\n--- Setup: read the tenant\'s current buyer_wanted_share_template (to restore after) ---');
    const settingsBefore = await call('/settings/share-templates');
    if (settingsBefore.status !== 200) throw new Error(`FAIL setup: GET share-templates: ${JSON.stringify(settingsBefore.body)}`);
    originalTemplate = settingsBefore.body.buyer_wanted_share_template;
    if ('buyer_wanted_share_template' in settingsBefore.body === false) {
      throw new Error('FAIL: GET /settings/share-templates response missing buyer_wanted_share_template key');
    }

    console.log('\n--- Setup: create an Inquiry and a Lead with real requirement data ---');
    const inquiryRes = await call('/inquiries', {
      method: 'POST',
      body: JSON.stringify({
        buyer_name: 'Broadcast Verify Buyer',
        intent: 'buy',
        property_type: 'condo_unit',
        budget_min: 3000000,
        budget_max: 5000000,
        target_city: 'Makati',
        bedrooms: 2,
        bathrooms: 2,
      }),
    });
    if (inquiryRes.status !== 201) throw new Error(`FAIL setup: create inquiry: ${JSON.stringify(inquiryRes.body)}`);
    inquiryId = inquiryRes.body.id;

    const leadRes = await call('/buyer-requirements', {
      method: 'POST',
      body: JSON.stringify({
        create_contact: { name: 'Broadcast Verify Contact' },
        intent: 'lease',
        property_type: 'house_and_lot',
        budget_min: 20000,
        target_city: 'Cebu City',
        bedrooms: 3,
      }),
    });
    if (leadRes.status !== 201) throw new Error(`FAIL setup: create lead: ${JSON.stringify(leadRes.body)}`);
    leadId = leadRes.body.id;
    contactId = leadRes.body.contact_id;
    console.log(`inquiry=${inquiryId} lead=${leadId} contact=${contactId}`);

    console.log('\n--- 1. broadcast-text with no template configured (or whatever the tenant currently has) reports template_configured accurately ---');
    // Temporarily clear the template so this check is deterministic regardless
    // of what the real test account already has configured.
    const clearRes = await call('/settings/share-templates', {
      method: 'PATCH',
      body: JSON.stringify({ buyer_wanted_share_template: '' }),
    });
    if (clearRes.status !== 200) throw new Error(`FAIL: clear template: ${JSON.stringify(clearRes.body)}`);
    const unconfigured = await call(`/inquiries/${inquiryId}/broadcast-text`);
    if (unconfigured.status !== 200) throw new Error(`FAIL: GET broadcast-text (unconfigured): ${JSON.stringify(unconfigured.body)}`);
    if (unconfigured.body.template_configured !== false || unconfigured.body.text !== null) {
      throw new Error(`FAIL: expected { text: null, template_configured: false }, got ${JSON.stringify(unconfigured.body)}`);
    }
    console.log('PASS');

    console.log('\n--- 2. PATCH /settings/share-templates persists buyer_wanted_share_template; GET returns it ---');
    const template =
      'Buyer wanted: {{intent}} {{property_type}} in {{target_city}}, budget {{budget_range}}, ' +
      '{{bedrooms}} BR / {{bathrooms}} BA — contact {{contact_name}}';
    const patchRes = await call('/settings/share-templates', {
      method: 'PATCH',
      body: JSON.stringify({ buyer_wanted_share_template: template }),
    });
    if (patchRes.status !== 200 || patchRes.body.buyer_wanted_share_template !== template) {
      throw new Error(`FAIL: PATCH did not persist template: ${JSON.stringify(patchRes.body)}`);
    }
    const getRes = await call('/settings/share-templates');
    if (getRes.body.buyer_wanted_share_template !== template) {
      throw new Error(`FAIL: GET did not reflect saved template: ${JSON.stringify(getRes.body)}`);
    }
    console.log('PASS');

    console.log('\n--- 3. GET /inquiries/:id/broadcast-text merges requirement fields correctly (no contact_name -- inquiries has none) ---');
    const inquiryBroadcast = await call(`/inquiries/${inquiryId}/broadcast-text`);
    if (inquiryBroadcast.status !== 200) throw new Error(`FAIL: GET inquiry broadcast-text: ${JSON.stringify(inquiryBroadcast.body)}`);
    if (inquiryBroadcast.body.template_configured !== true) throw new Error('FAIL: expected template_configured true');
    const inquiryText = inquiryBroadcast.body.text as string;
    const expectedFragmentsInquiry = ['buy', 'condo_unit', 'Makati', '2 BR', '2 BA', 'PHP 3,000,000 – 5,000,000'];
    for (const fragment of expectedFragmentsInquiry) {
      if (!inquiryText.includes(fragment)) throw new Error(`FAIL: inquiry broadcast text missing "${fragment}": ${inquiryText}`);
    }
    if (inquiryText.includes('contact')) {
      // contact_name resolves to '' for an Inquiry -- "contact " prefix from
      // the template should still appear (literal text), but never a
      // dangling {{contact_name}} token.
      if (inquiryText.includes('{{contact_name}}')) throw new Error('FAIL: unmerged {{contact_name}} token in inquiry text');
    }
    console.log(`inquiry text: ${inquiryText}`);
    console.log('PASS');

    console.log('\n--- 4. GET /buyer-requirements/:id/broadcast-text merges requirement fields AND contact_name (via contacts join) ---');
    const leadBroadcast = await call(`/buyer-requirements/${leadId}/broadcast-text`);
    if (leadBroadcast.status !== 200) throw new Error(`FAIL: GET lead broadcast-text: ${JSON.stringify(leadBroadcast.body)}`);
    if (leadBroadcast.body.template_configured !== true) throw new Error('FAIL: expected template_configured true');
    const leadText = leadBroadcast.body.text as string;
    const expectedFragmentsLead = ['lease', 'house_and_lot', 'Cebu City', '3 BR', 'Broadcast Verify Contact'];
    for (const fragment of expectedFragmentsLead) {
      if (!leadText.includes(fragment)) throw new Error(`FAIL: lead broadcast text missing "${fragment}": ${leadText}`);
    }
    // budget_max was never set on this lead -- budget_range must degrade to
    // just the min, not throw or render "undefined"/"NaN".
    if (!leadText.includes('PHP 20,000') || leadText.includes('undefined') || leadText.includes('NaN')) {
      throw new Error(`FAIL: budget_range did not degrade gracefully for a min-only budget: ${leadText}`);
    }
    console.log(`lead text: ${leadText}`);
    console.log('PASS');

    console.log('\n--- 5. 404 for a broadcast-text request against a record outside the caller\'s tenant/nonexistent id ---');
    const notFound = await call(`/buyer-requirements/00000000-0000-0000-0000-000000000000/broadcast-text`);
    if (notFound.status !== 404) throw new Error(`FAIL: expected 404, got ${notFound.status}: ${JSON.stringify(notFound.body)}`);
    console.log('PASS');

    console.log('\n=== ALL DOD CHECKS PASSED ===');
  } finally {
    console.log('\n--- Cleanup ---');
    if (inquiryId) await supabaseAdmin.from('inquiries').delete().eq('id', inquiryId);
    if (leadId) await supabaseAdmin.from('buyer_requirements').delete().eq('id', leadId);
    if (contactId) await supabaseAdmin.from('contacts').delete().eq('id', contactId);
    if (originalTemplate !== undefined) {
      await supabaseAdmin
        .from('workspace_sharing_settings')
        .update({ buyer_wanted_share_template: originalTemplate })
        .eq('tenant_id', tenantId);
    }
    console.log('Cleaned up, template restored.');
  }
}

main().catch((err) => {
  console.error('\n=== VERIFICATION FAILED ===');
  console.error(err);
  process.exit(1);
});
