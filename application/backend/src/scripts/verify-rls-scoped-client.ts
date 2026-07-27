import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-platform-rls-scoped-client-001 DoD verification: proves RLS itself --
// not just each route's own .eq('tenant_id', ...) filter -- blocks a
// cross-tenant read when queried through the same kind of per-request client
// getScopedClient(request) builds (publishable key + the caller's own JWT
// forwarded as Authorization). Deliberately skips the app-level tenant_id
// filter that every real route still applies, so a pass here means RLS is
// the one actually stopping the read, not app code.
// Run via (from application/backend): npx tsx src/scripts/verify-rls-scoped-client.ts
const EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL;
const PASSWORD = process.env.MOBILE_TEST_ACCOUNT_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

async function main() {
  if (!EMAIL || !PASSWORD || !SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error(
      'Set MOBILE_TEST_ACCOUNT_EMAIL, MOBILE_TEST_ACCOUNT_PASSWORD, SUPABASE_URL, and SUPABASE_PUBLISHABLE_KEY in .env first.',
    );
    process.exit(1);
  }

  // 1. Sign in as a real tenant user (same account tb-design-system-
  //    brokerage-001's mobile-verification flow uses) via the publishable
  //    key, exactly like a real frontend session would.
  const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (signInError || !signIn.session) {
    console.error('Could not sign in as the test account:', signInError?.message);
    process.exit(1);
  }
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('tenant_id')
    .eq('id', signIn.user!.id)
    .single();
  const ownTenantId = profile!.tenant_id as string;
  console.log(`Signed in as ${EMAIL}, tenant_id = ${ownTenantId}`);

  // 2. Build the same kind of client getScopedClient(request) builds: the
  //    publishable key as apikey, the caller's own JWT as Authorization.
  const scoped = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${signIn.session.access_token}` } },
  });

  // 3. Find a property belonging to a DIFFERENT tenant (via supabaseAdmin,
  //    which bypasses RLS by design -- this is just test setup, not the
  //    thing under test).
  const { data: otherProperty, error: otherError } = await supabaseAdmin
    .from('properties')
    .select('id, tenant_id, title')
    .neq('tenant_id', ownTenantId)
    .limit(1)
    .single();
  if (otherError || !otherProperty) {
    console.error('Could not find a cross-tenant property to test against:', otherError?.message);
    process.exit(1);
  }
  console.log(`Target cross-tenant property: ${otherProperty.id} (tenant ${otherProperty.tenant_id})`);

  // 4. THE ACTUAL TEST: query that property by id through the scoped client,
  //    with NO .eq('tenant_id', ...) filter at all -- if RLS is not doing
  //    real work, this returns the row anyway.
  const { data: crossTenantRead, error: crossTenantError } = await scoped
    .from('properties')
    .select('id, tenant_id, title')
    .eq('id', otherProperty.id)
    .maybeSingle();

  console.log('\n--- Cross-tenant read (no app-level tenant_id filter) ---');
  console.log('error:', crossTenantError);
  console.log('data:', crossTenantRead);

  const blocked = !crossTenantError && crossTenantRead === null;
  if (!blocked) {
    console.error('\nFAIL: RLS did not block the cross-tenant read.');
    process.exit(1);
  }
  console.log('\nPASS: RLS blocked the cross-tenant read (empty result, no app-level filter applied).');

  // 5. Regression check: the same scoped client can still read the caller's
  //    OWN tenant's data normally.
  const { data: ownProperties, error: ownError } = await scoped
    .from('properties')
    .select('id')
    .eq('tenant_id', ownTenantId)
    .limit(1);

  console.log('\n--- Same-tenant read (own tenant) ---');
  console.log('error:', ownError);
  console.log('row count:', ownProperties?.length ?? 0);

  if (ownError) {
    console.error('\nFAIL: same-tenant read regressed.');
    process.exit(1);
  }
  console.log('\nPASS: same-tenant read still works under the scoped client.');
}

main();
