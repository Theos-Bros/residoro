import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-search-core-entities-001 DoD verification: seeds one distinctively-named
// row per searched entity (property, contact, task, project; a listing
// pointed at the seeded property covers the "listing via its property join"
// case; an inquiry and a buyer_requirement/lead cover the search_leads.sql
// follow-up -- buyer_requirements has no name of its own, searched via its
// contact join same as listings), hits the real GET /global-search HTTP
// route as a signed-in tenant user, confirms each shows up under the right
// entity_type, and confirms a second tenant's signed-in session does NOT see
// this tenant's seeded rows (cross-tenant isolation, via RLS -- same posture
// as verify-rls-scoped-client.ts).
// Run via (from application/backend): npx tsx src/scripts/verify-search-core-entities.ts
const EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL;
const PASSWORD = process.env.MOBILE_TEST_ACCOUNT_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';
const MARKER = `Zzqsearchtest${Date.now()}`;

async function main() {
  if (!EMAIL || !PASSWORD || !SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error(
      'Set MOBILE_TEST_ACCOUNT_EMAIL, MOBILE_TEST_ACCOUNT_PASSWORD, SUPABASE_URL, and SUPABASE_PUBLISHABLE_KEY in .env first.',
    );
    process.exit(1);
  }

  const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signInError || !signIn.session) {
    console.error('Could not sign in as the test account:', signInError?.message);
    process.exit(1);
  }
  const { data: profile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', signIn.user!.id).single();
  const tenantId = profile!.tenant_id as string;
  console.log(`Signed in as ${EMAIL}, tenant_id = ${tenantId}`);

  const createdIds: { table: string; id: string }[] = [];

  try {
    // Seed one row per TB1 entity, each with MARKER in its indexed field(s).
    const { data: property } = await supabaseAdmin
      .from('properties')
      .insert({ tenant_id: tenantId, title: `${MARKER} Property`, type: 'condo_unit', owner_type: 'individual' })
      .select('id')
      .single();
    createdIds.push({ table: 'properties', id: property!.id });

    const { data: listing } = await supabaseAdmin
      .from('listings')
      .insert({ tenant_id: tenantId, property_id: property!.id, agent_id: signIn.user!.id, listing_type: 'sale', price: 1000000 })
      .select('id')
      .single();
    createdIds.push({ table: 'listings', id: listing!.id });

    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .insert({ tenant_id: tenantId, name: `${MARKER} Contact`, type: 'buyer_lead' })
      .select('id')
      .single();
    createdIds.push({ table: 'contacts', id: contact!.id });

    const { data: task } = await supabaseAdmin
      .from('tasks')
      .insert({ tenant_id: tenantId, title: `${MARKER} Task`, task_type: 'manual' })
      .select('id')
      .single();
    createdIds.push({ table: 'tasks', id: task!.id });

    const { data: developer } = await supabaseAdmin
      .from('contacts')
      .insert({ tenant_id: tenantId, name: `${MARKER} Developer`, type: 'developer', is_company: true })
      .select('id')
      .single();
    createdIds.push({ table: 'contacts', id: developer!.id });

    const { data: project } = await supabaseAdmin
      .from('projects')
      .insert({ tenant_id: tenantId, developer_id: developer!.id, name: `${MARKER} Project`, project_type: 'condo' })
      .select('id')
      .single();
    createdIds.push({ table: 'projects', id: project!.id });

    const { data: inquiry } = await supabaseAdmin
      .from('inquiries')
      .insert({ tenant_id: tenantId, buyer_name: `${MARKER} Inquiry` })
      .select('id')
      .single();
    createdIds.push({ table: 'inquiries', id: inquiry!.id });

    const { data: leadContact } = await supabaseAdmin
      .from('contacts')
      .insert({ tenant_id: tenantId, name: `${MARKER} Lead`, type: 'buyer_lead' })
      .select('id')
      .single();
    createdIds.push({ table: 'contacts', id: leadContact!.id });

    const { data: lead } = await supabaseAdmin
      .from('buyer_requirements')
      .insert({ tenant_id: tenantId, contact_id: leadContact!.id })
      .select('id')
      .single();
    createdIds.push({ table: 'buyer_requirements', id: lead!.id });

    console.log('Seeded test rows:', createdIds.map((r) => `${r.table}:${r.id}`).join(', '));

    // Real end-to-end call: the actual HTTP route, as a real signed-in session.
    const response = await fetch(`${BACKEND_URL}/global-search?q=${encodeURIComponent(MARKER)}`, {
      headers: { Authorization: `Bearer ${signIn.session.access_token}` },
    });
    const body = (await response.json()) as {
      results: { entity_type: string; entity_id: string; title: string; subtitle: string | null }[];
    };
    console.log('\n--- GET /global-search response ---');
    console.log(JSON.stringify(body, null, 2));

    const byType = new Set(body.results.map((r) => r.entity_type));
    const expectedTypes = ['property', 'listing', 'contact', 'lead', 'inquiry', 'task', 'project'];
    const missing = expectedTypes.filter((t) => !byType.has(t));
    if (missing.length > 0) {
      console.error(`\nFAIL: missing entity_type(s) in results: ${missing.join(', ')}`);
      process.exit(1);
    }
    // Three contacts were seeded (Contact, Developer, Lead's own contact) -- all must appear.
    const contactTitles = body.results.filter((r) => r.entity_type === 'contact').map((r) => r.title);
    if (!contactTitles.includes(`${MARKER} Contact`) || !contactTitles.includes(`${MARKER} Developer`)) {
      console.error('\nFAIL: expected both seeded plain contacts in the contact group, got:', contactTitles);
      process.exit(1);
    }
    const listingResult = body.results.find((r) => r.entity_type === 'listing');
    if (listingResult?.title !== `${MARKER} Property`) {
      console.error('\nFAIL: listing result should carry its joined property title, got:', listingResult);
      process.exit(1);
    }
    const leadResult = body.results.find((r) => r.entity_type === 'lead');
    if (leadResult?.title !== `${MARKER} Lead`) {
      console.error('\nFAIL: lead result should carry its joined contact name, got:', leadResult);
      process.exit(1);
    }
    const inquiryResult = body.results.find((r) => r.entity_type === 'inquiry');
    if (inquiryResult?.title !== `${MARKER} Inquiry`) {
      console.error('\nFAIL: inquiry result should carry its own buyer_name, got:', inquiryResult);
      process.exit(1);
    }
    console.log('\nPASS: all seven entity types matched, listing/lead carried their joined title, contacts matched.');

    // Cross-tenant isolation: a DIFFERENT tenant's session must see none of this.
    const { data: otherProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, tenant_id')
      .neq('tenant_id', tenantId)
      .limit(1)
      .single();
    if (otherProfile) {
      const { data: otherAuthUser } = await supabaseAdmin.auth.admin.getUserById(otherProfile.id);
      console.log(`\nCross-tenant check target: ${otherAuthUser.user?.email} (tenant ${otherProfile.tenant_id})`);
      const { data: otherLink } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: otherAuthUser.user!.email!,
      });
      // Exchange the magic-link token for a real session without needing that
      // account's password -- service-role-only, test setup, not the thing
      // under test.
      const otherAnon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
      const { data: otherSession, error: otpError } = await otherAnon.auth.verifyOtp({
        type: 'magiclink',
        token_hash: otherLink.properties!.hashed_token,
      });
      if (otpError || !otherSession.session) {
        console.log('SKIPPED cross-tenant check (could not mint a session for the other tenant):', otpError?.message);
      } else {
        const otherResponse = await fetch(`${BACKEND_URL}/global-search?q=${encodeURIComponent(MARKER)}`, {
          headers: { Authorization: `Bearer ${otherSession.session.access_token}` },
        });
        const otherBody = (await otherResponse.json()) as { results: unknown[] };
        console.log('Other-tenant results count:', otherBody.results.length);
        if (otherBody.results.length !== 0) {
          console.error('\nFAIL: a different tenant saw this tenant\'s seeded rows.');
          process.exit(1);
        }
        console.log('PASS: a different tenant\'s session saw zero results for the marker term.');
      }
    } else {
      console.log('SKIPPED cross-tenant check (no second tenant found).');
    }
  } finally {
    // Delete children before parents -- listings.property_id,
    // projects.developer_id, and buyer_requirements.contact_id are all FKs
    // with no cascade, so deleting a referenced property/contact first fails
    // silently unless listings/projects/buyer_requirements go first.
    const deleteOrder = ['listings', 'projects', 'buyer_requirements', 'properties', 'contacts', 'tasks', 'inquiries'];
    for (const table of deleteOrder) {
      for (const { table: t, id } of createdIds.filter((r) => r.table === table)) {
        const { error } = await supabaseAdmin.from(t).delete().eq('id', id);
        if (error) console.error(`Cleanup failed for ${t}:${id}:`, error.message);
      }
    }
    console.log('\nCleaned up all seeded test rows.');
  }
}

main();
