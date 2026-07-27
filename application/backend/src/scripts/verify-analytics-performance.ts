import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-analytics-share-performance-001 DoD verification: share events log on
// POST, GET /listings/performance returns accurate trailing-30-day counts and
// a correct hot flag against the workspace's own threshold, Settings access
// matches Sharing Templates' view-all/edit-admin pattern, and cross-tenant
// access is blocked -- against the real running backend and Supabase project.
// Run via (from application/backend): npx tsx src/scripts/verify-analytics-performance.ts
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

  const { data: originalWorkspace } = await supabaseAdmin
    .from('workspaces')
    .select('hot_share_threshold')
    .eq('id', profile!.tenant_id)
    .single();
  const originalThreshold = originalWorkspace!.hot_share_threshold;
  console.log(`Original hot_share_threshold=${originalThreshold}`);

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

  try {
    console.log('\n--- 1. GET /settings/performance is viewable regardless of role ---');
    const getSettings = await call('/settings/performance');
    console.log(getSettings);
    if (getSettings.status !== 200) throw new Error('FAIL: GET /settings/performance should be viewable by any member');
    console.log('PASS');

    console.log('\n--- 2. PATCH /settings/performance sets threshold to 2 (admin only) ---');
    const patchSettings = await call('/settings/performance', {
      method: 'PATCH',
      body: JSON.stringify({ hot_share_threshold: 2 }),
    });
    console.log(patchSettings);
    if (profile!.role === 'admin') {
      if (patchSettings.status !== 200 || patchSettings.body.hot_share_threshold !== 2) {
        throw new Error('FAIL: admin could not set hot_share_threshold');
      }
      console.log('PASS');
    } else {
      if (patchSettings.status !== 403) throw new Error('FAIL: non-admin should get 403 editing performance settings');
      console.log('PASS (403 as expected for non-admin)');
      // Force the threshold to 2 directly so the rest of the script can still
      // exercise the hot-flag logic regardless of this test account's role.
      await supabaseAdmin.from('workspaces').update({ hot_share_threshold: 2 }).eq('id', profile!.tenant_id);
    }

    console.log('\n--- 3. POST /listings/:id/share-events with invalid audience -> 400 ---');
    const badAudience = await call(`/listings/${listing.id}/share-events`, {
      method: 'POST',
      body: JSON.stringify({ audience: 'nonsense' }),
    });
    console.log(badAudience);
    if (badAudience.status !== 400) throw new Error('FAIL: invalid audience should be 400');
    console.log('PASS');

    console.log('\n--- 4. Clear any pre-existing share events for this listing (clean baseline) ---');
    await supabaseAdmin.from('listing_share_events').delete().eq('listing_id', listing.id);
    console.log('done');

    console.log('\n--- 5. POST two valid share events -> both 201 ---');
    const first = await call(`/listings/${listing.id}/share-events`, {
      method: 'POST',
      body: JSON.stringify({ audience: 'public' }),
    });
    console.log(first);
    if (first.status !== 201) throw new Error('FAIL: first share event should be 201');

    const second = await call(`/listings/${listing.id}/share-events`, {
      method: 'POST',
      body: JSON.stringify({ audience: 'co_broker' }),
    });
    console.log(second);
    if (second.status !== 201) throw new Error('FAIL: second share event should be 201');
    console.log('PASS');

    console.log('\n--- 6. GET /listings/performance: count=2, hot=true (threshold=2) ---');
    const performance = await call('/listings/performance');
    const row = performance.body.listings.find((l: any) => l.listing_id === listing.id);
    console.log(row);
    if (!row) throw new Error('FAIL: listing missing from performance response');
    if (row.share_count_30d !== 2) throw new Error(`FAIL: expected share_count_30d=2, got ${row.share_count_30d}`);
    if (row.hot !== true) throw new Error('FAIL: expected hot=true at count 2 with threshold 2');
    console.log('PASS');

    console.log('\n--- 7. Cross-tenant listing -> 404 on POST /share-events ---');
    const { data: otherListing } = await supabaseAdmin
      .from('listings')
      .select('id, tenant_id')
      .neq('tenant_id', profile!.tenant_id)
      .limit(1)
      .single();
    if (otherListing) {
      const crossTenant = await call(`/listings/${otherListing.id}/share-events`, {
        method: 'POST',
        body: JSON.stringify({ audience: 'public' }),
      });
      console.log(crossTenant);
      if (crossTenant.status !== 404) throw new Error('FAIL: cross-tenant listing should be 404');
      console.log('PASS');
    } else {
      console.log('SKIP (no cross-tenant listing available to test against)');
    }

    console.log('\n--- 8. Cross-tenant isolation: GET /listings/performance never includes another tenant listing ---');
    if (otherListing) {
      const leaked = performance.body.listings.some((l: any) => l.listing_id === otherListing.id);
      if (leaked) throw new Error('FAIL: cross-tenant listing leaked into performance response');
      console.log('PASS');
    } else {
      console.log('SKIP (no cross-tenant listing available to test against)');
    }

    console.log('\nAll checks passed.');
  } finally {
    console.log('\n--- Cleanup: remove test share events, restore original hot_share_threshold ---');
    await supabaseAdmin.from('listing_share_events').delete().eq('listing_id', listing.id);
    await supabaseAdmin.from('workspaces').update({ hot_share_threshold: originalThreshold }).eq('id', profile!.tenant_id);
    console.log('done');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
