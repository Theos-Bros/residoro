import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// tb-user-profile-display-name-001 DoD verification:
//   1. GET/PATCH /me/profile work for a tenant user (MOBILE_TEST_ACCOUNT_*)
//      and for an operator (BILLING_VERIFY_OPERATOR_*), reusing existing
//      throwaway test accounts rather than minting new ones.
//   2. Each identity only ever reads/writes their OWN name -- verified
//      by round-tripping a distinct value per identity and confirming no
//      cross-identity bleed.
// Updated by tb-user-profile-name-split-001: full_name no longer exists as a
// PATCH key (replaced by first_name/last_name) -- this script's PATCH calls
// and assertions were updated to match; the DoD intent (round-trip + no
// cross-identity bleed) is unchanged.
// Requires the local backend dev server running (npm run dev, from
// application/backend) for these HTTP calls.
// Run via (from application/backend): npx tsx src/scripts/verify-user-profile-display-name.ts
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;

const TENANT_EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL;
const TENANT_PASSWORD = process.env.MOBILE_TEST_ACCOUNT_PASSWORD;
const OPERATOR_EMAIL = process.env.BILLING_VERIFY_OPERATOR_EMAIL;
const OPERATOR_PASSWORD = process.env.BILLING_VERIFY_OPERATOR_PASSWORD;

let failures = 0;

function check(label: string, pass: boolean, detail?: unknown) {
  if (pass) {
    console.log(`PASS: ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${label}`, detail ?? '');
  }
}

async function signIn(email: string, password: string) {
  const anon = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Could not sign in as ${email}: ${error?.message}`);
  }
  return data.session;
}

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !TENANT_EMAIL || !TENANT_PASSWORD || !OPERATOR_EMAIL || !OPERATOR_PASSWORD) {
    console.error('Missing required env vars -- see the top of this script for the full list.');
    process.exit(1);
  }

  const tenantSession = await signIn(TENANT_EMAIL, TENANT_PASSWORD);
  const tenantHeaders = { Authorization: `Bearer ${tenantSession.access_token}`, 'Content-Type': 'application/json' };

  const operatorSession = await signIn(OPERATOR_EMAIL, OPERATOR_PASSWORD);
  const operatorHeaders = { Authorization: `Bearer ${operatorSession.access_token}`, 'Content-Type': 'application/json' };

  // ------------------------------------------------------------------------
  // 1. Tenant user: GET then PATCH their own first_name
  // ------------------------------------------------------------------------
  const tenantGetRes = await fetch(`${BACKEND_URL}/me/profile`, { headers: tenantHeaders });
  const tenantGetBody = await tenantGetRes.json();
  check('tenant user GET /me/profile succeeds', tenantGetRes.ok, tenantGetBody);

  const tenantNewName = `TenantVerify${Date.now()}`;
  const tenantPatchRes = await fetch(`${BACKEND_URL}/me/profile`, {
    method: 'PATCH',
    headers: tenantHeaders,
    body: JSON.stringify({ first_name: tenantNewName }),
  });
  const tenantPatchBody = await tenantPatchRes.json();
  check(
    'tenant user PATCH /me/profile updates their own first_name',
    tenantPatchRes.ok && tenantPatchBody.first_name === tenantNewName,
    tenantPatchBody,
  );

  // ------------------------------------------------------------------------
  // 2. Operator: GET then PATCH their own first_name (the case
  //    profiles_select_same_tenant alone could NOT satisfy -- both sides of
  //    that comparison are null for an operator; profiles_select_own
  //    (20260806110000_profiles_self_select.sql) is what makes this pass).
  // ------------------------------------------------------------------------
  const operatorGetRes = await fetch(`${BACKEND_URL}/me/profile`, { headers: operatorHeaders });
  const operatorGetBody = await operatorGetRes.json();
  check('operator GET /me/profile succeeds (profiles_select_own)', operatorGetRes.ok, operatorGetBody);

  const operatorNewName = `OperatorVerify${Date.now()}`;
  const operatorPatchRes = await fetch(`${BACKEND_URL}/me/profile`, {
    method: 'PATCH',
    headers: operatorHeaders,
    body: JSON.stringify({ first_name: operatorNewName }),
  });
  const operatorPatchBody = await operatorPatchRes.json();
  check(
    'operator PATCH /me/profile updates their own first_name',
    operatorPatchRes.ok && operatorPatchBody.first_name === operatorNewName,
    operatorPatchBody,
  );

  // ------------------------------------------------------------------------
  // 3. No cross-identity bleed: re-fetching each identity still shows only
  //    their own just-written value, not the other identity's.
  // ------------------------------------------------------------------------
  const tenantRefetchRes = await fetch(`${BACKEND_URL}/me/profile`, { headers: tenantHeaders });
  const tenantRefetchBody = await tenantRefetchRes.json();
  check(
    'tenant user re-fetch shows their own value, not the operator\'s',
    tenantRefetchBody.first_name === tenantNewName,
    tenantRefetchBody,
  );

  const operatorRefetchRes = await fetch(`${BACKEND_URL}/me/profile`, { headers: operatorHeaders });
  const operatorRefetchBody = await operatorRefetchRes.json();
  check(
    'operator re-fetch shows their own value, not the tenant user\'s',
    operatorRefetchBody.first_name === operatorNewName,
    operatorRefetchBody,
  );

  // ------------------------------------------------------------------------
  // 4. Validation: empty first_name is rejected
  // ------------------------------------------------------------------------
  const emptyRes = await fetch(`${BACKEND_URL}/me/profile`, {
    method: 'PATCH',
    headers: tenantHeaders,
    body: JSON.stringify({ first_name: '' }),
  });
  check('PATCH with empty first_name is rejected (400)', emptyRes.status === 400);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
