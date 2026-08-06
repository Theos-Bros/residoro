import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// tb-billing-brokerage-view-001 DoD verification:
//   1. GET /workspace/billing as the tenant's own admin succeeds and returns
//      contract_billing + installments (reading through the RLS SELECT
//      policy tb-billing-installments-001 shipped).
//   2. GET /workspace/billing as a non-admin member of the SAME tenant is
//      blocked with a 403 at the app level.
// Requires the local backend dev server running (npm run dev, from
// application/backend).
// Run via (from application/backend): npx tsx src/scripts/verify-billing-brokerage-view.ts
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;

const ADMIN_EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL;
const ADMIN_PASSWORD = process.env.MOBILE_TEST_ACCOUNT_PASSWORD;
const MEMBER_EMAIL = process.env.BILLING_VERIFY_MEMBER_EMAIL;
const MEMBER_PASSWORD = process.env.BILLING_VERIFY_MEMBER_PASSWORD;

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
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !ADMIN_EMAIL || !ADMIN_PASSWORD || !MEMBER_EMAIL || !MEMBER_PASSWORD) {
    console.error('Missing required env vars -- see the top of this script for the full list.');
    process.exit(1);
  }

  const adminSession = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  const adminRes = await fetch(`${BACKEND_URL}/workspace/billing`, {
    headers: { Authorization: `Bearer ${adminSession.access_token}` },
  });
  const adminBody: any = await adminRes.json();
  check(
    'admin GET /workspace/billing succeeds and returns contract_billing + installments shape',
    adminRes.ok && 'contract_billing' in adminBody && Array.isArray(adminBody.installments),
    adminBody,
  );

  const memberSession = await signIn(MEMBER_EMAIL, MEMBER_PASSWORD);
  const memberRes = await fetch(`${BACKEND_URL}/workspace/billing`, {
    headers: { Authorization: `Bearer ${memberSession.access_token}` },
  });
  const memberBody = await memberRes.json();
  check('non-admin member GET /workspace/billing is blocked with 403', memberRes.status === 403, memberBody);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
