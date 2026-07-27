import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-crm-developer-consolidation-001 DoD verification: developers is folded into
// contacts via is_company; /developers and /projects keep their response shape;
// resolveOwner() in shareText.ts resolves every owner_type through contacts now.
// Run via (from application/backend): npx tsx src/scripts/verify-crm-developer-consolidation.ts
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

  let createdDeveloperId: string | undefined;
  let createdProjectId: string | undefined;
  let createdPropertyId: string | undefined;

  try {
    console.log('\n--- 0. developers table no longer exists ---');
    const missing = await supabaseAdmin.from('developers' as any).select('id').limit(1);
    if (!missing.error) throw new Error('FAIL: developers table still queryable, should have been dropped');
    console.log('PASS (developers table no longer exists):', missing.error.message);

    console.log('\n--- 1. GET /developers returns {developers: [...]} shape ---');
    const listBefore = await call('/developers');
    console.log(listBefore);
    if (listBefore.status !== 200 || !Array.isArray(listBefore.body.developers)) {
      throw new Error('FAIL: GET /developers should return { developers: [] }');
    }
    console.log('PASS');

    console.log('\n--- 2. POST /developers creates a contacts row with is_company=true ---');
    const created = await call('/developers', {
      method: 'POST',
      body: JSON.stringify({ name: 'Verify-CRM Developer Co.' }),
    });
    console.log(created);
    if (created.status !== 201 || !created.body.id) throw new Error('FAIL: POST /developers should 201 with an id');
    createdDeveloperId = created.body.id;

    const { data: contactRow } = await supabaseAdmin
      .from('contacts')
      .select('id, name, type, is_company, tenant_id')
      .eq('id', createdDeveloperId)
      .single();
    console.log(contactRow);
    if (!contactRow || contactRow.is_company !== true || contactRow.type !== 'developer') {
      throw new Error('FAIL: expected a contacts row with is_company=true, type=developer');
    }
    console.log('PASS');

    console.log('\n--- 3. GET /developers now includes the new one ---');
    const listAfter = await call('/developers');
    const found = listAfter.body.developers.find((d: any) => d.id === createdDeveloperId);
    if (!found) throw new Error('FAIL: newly created developer missing from GET /developers');
    console.log('PASS');

    console.log('\n--- 4. POST /projects with the new developer_id succeeds, GET /projects shows developer_name ---');
    const project = await call('/projects', {
      method: 'POST',
      body: JSON.stringify({
        developer_id: createdDeveloperId,
        name: 'Verify-CRM Project',
        project_type: 'condo',
      }),
    });
    console.log(project);
    if (project.status !== 201) throw new Error('FAIL: POST /projects should 201');
    createdProjectId = project.body.id;

    const projectDetail = await call(`/projects/${createdProjectId}`);
    console.log(projectDetail);
    if (projectDetail.body.developer_name !== 'Verify-CRM Developer Co.') {
      throw new Error(`FAIL: expected developer_name to resolve via contacts, got ${projectDetail.body.developer_name}`);
    }
    console.log('PASS');

    console.log('\n--- 5. POST /projects with a nonexistent developer_id -> 404 ---');
    const badDev = await call('/projects', {
      method: 'POST',
      body: JSON.stringify({
        developer_id: '00000000-0000-0000-0000-000000000000',
        name: 'Should Fail',
        project_type: 'condo',
      }),
    });
    console.log(badDev);
    if (badDev.status !== 404) throw new Error('FAIL: nonexistent developer_id should 404');
    console.log('PASS');

    console.log('\n--- 6. resolveOwner via share-text: owner_type=developer resolves through contacts ---');
    const { data: property, error: propError } = await supabaseAdmin
      .from('properties')
      .insert({
        tenant_id: tenantId,
        type: 'condo_unit',
        owner_type: 'developer',
        owner_id: createdDeveloperId,
        title: 'Verify-CRM Property',
        created_by: signIn.user!.id,
      })
      .select('id')
      .single();
    if (propError || !property) throw new Error(`FAIL: could not create test property: ${propError?.message}`);
    createdPropertyId = property.id;

    const listingRes = await call('/listings', {
      method: 'POST',
      body: JSON.stringify({
        property_id: createdPropertyId,
        listing_type: 'sale',
        price: 1000000,
        exclusivity: 'exclusive',
        authority_starts_at: new Date().toISOString().slice(0, 10),
      }),
    });
    console.log(listingRes);
    if (listingRes.status !== 201) throw new Error('FAIL: could not create a listing to test share-text against');

    const shareText = await call(`/listings/${listingRes.body.id}/share-text?audience=internal`);
    console.log(shareText);
    if (shareText.status !== 200) throw new Error('FAIL: GET share-text should be 200');
    if (!JSON.stringify(shareText.body).includes('Verify-CRM Developer Co.')) {
      throw new Error('FAIL: expected the developer contact name to appear in internal share text owner fields');
    }
    console.log('PASS (owner_type=developer resolved via contacts, not the old developers table)');

    console.log('\nAll checks passed.');
  } finally {
    console.log('\n--- Cleanup ---');
    if (createdPropertyId) {
      await supabaseAdmin.from('listings').delete().eq('property_id', createdPropertyId);
      await supabaseAdmin.from('properties').delete().eq('id', createdPropertyId);
    }
    if (createdProjectId) await supabaseAdmin.from('projects').delete().eq('id', createdProjectId);
    if (createdDeveloperId) await supabaseAdmin.from('contacts').delete().eq('id', createdDeveloperId);
    console.log('done');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
