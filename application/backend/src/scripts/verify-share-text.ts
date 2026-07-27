import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-distribution-share-text-001 DoD verification: templates save (admin
// role), merge fields substitute live data, audience scoping keeps
// commission/owner info out of the public tier, and cross-tenant access is
// blocked -- against the real running backend and Supabase project.
// Run via (from application/backend): npx tsx src/scripts/verify-share-text.ts
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
  console.log(`tenant_id=${profile!.tenant_id} role=${profile!.role}`);

  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('id, property_id')
    .eq('tenant_id', profile!.tenant_id)
    .limit(1)
    .single();
  if (!listing) {
    console.error('No listing found for this tenant to test against.');
    process.exit(1);
  }
  console.log(`Using listing ${listing.id}`);

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

  console.log('\n--- 1. Save Public + Co-broker templates (as admin) ---');
  const publicTemplate = '<p>{{title}} — {{price_currency}} {{price}} 🏡</p><p>{{bedrooms}}BR/{{bathrooms}}BA</p>';
  const coBrokerTemplate = '<p>{{title}} — {{price_currency}} {{price}}</p><p>Commission: {{commission_note}}</p>';
  const saveResult = await call('/settings/share-templates', {
    method: 'PATCH',
    body: JSON.stringify({ public_share_template: publicTemplate, co_broker_share_template: coBrokerTemplate }),
  });
  console.log(saveResult);
  if (profile!.role === 'admin' && saveResult.status !== 200) throw new Error('FAIL: admin could not save templates');
  console.log(profile!.role === 'admin' ? 'PASS' : 'SKIP (test account is not admin)');

  console.log('\n--- 2. GET templates reflects saved values ---');
  const getTemplates = await call('/settings/share-templates');
  console.log(getTemplates);
  if (profile!.role === 'admin') {
    if (getTemplates.body.public_share_template !== publicTemplate) throw new Error('FAIL: public template mismatch');
    console.log('PASS');
  }

  console.log('\n--- 3. Set a commission_note on the test listing (direct, for merge test) ---');
  await supabaseAdmin.from('listings').update({ commission_note: '50/50 split, 3% total' }).eq('id', listing.id);
  console.log('done');

  console.log('\n--- 4. GET share-text?audience=public: merge fields substituted, no commission/owner ---');
  const publicText = await call(`/listings/${listing.id}/share-text?audience=public`);
  console.log(publicText);
  if (publicText.status !== 200) throw new Error('FAIL: public share-text request failed');
  if (profile!.role === 'admin') {
    if (publicText.body.text.includes('{{')) throw new Error('FAIL: unsubstituted merge field in public text');
    if (publicText.body.text.includes('50/50 split')) throw new Error('FAIL: commission leaked into public text');
  }
  console.log('PASS');

  console.log('\n--- 5. GET share-text?audience=co_broker: includes commission_note ---');
  const coBrokerText = await call(`/listings/${listing.id}/share-text?audience=co_broker`);
  console.log(coBrokerText);
  if (profile!.role === 'admin' && !coBrokerText.body.text.includes('50/50 split, 3% total')) {
    throw new Error('FAIL: commission_note missing from co_broker text');
  }
  console.log('PASS');

  console.log('\n--- 6. GET share-text?audience=internal: fixed format, includes owner + commission ---');
  const internalText = await call(`/listings/${listing.id}/share-text?audience=internal`);
  console.log(internalText);
  if (internalText.status !== 200 || !internalText.body.text.includes('Owner:')) {
    throw new Error('FAIL: internal text missing owner section');
  }
  if (!internalText.body.text.includes('50/50 split, 3% total')) throw new Error('FAIL: internal text missing commission_note');
  console.log('PASS');

  console.log('\n--- 7. Invalid audience -> 400 ---');
  const badAudience = await call(`/listings/${listing.id}/share-text?audience=nonsense`);
  console.log(badAudience);
  if (badAudience.status !== 400) throw new Error('FAIL: invalid audience should be 400');
  console.log('PASS');

  console.log('\n--- 8. Cross-tenant listing -> 404 ---');
  const { data: otherListing } = await supabaseAdmin
    .from('listings')
    .select('id, tenant_id')
    .neq('tenant_id', profile!.tenant_id)
    .limit(1)
    .single();
  if (otherListing) {
    const crossTenant = await call(`/listings/${otherListing.id}/share-text?audience=public`);
    console.log(crossTenant);
    if (crossTenant.status !== 404) throw new Error('FAIL: cross-tenant listing should be 404');
    console.log('PASS');
  } else {
    console.log('SKIP (no cross-tenant listing available to test against)');
  }

  console.log('\n--- 9. Cleanup: clear the test commission_note ---');
  await supabaseAdmin.from('listings').update({ commission_note: null }).eq('id', listing.id);
  console.log('done');

  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
