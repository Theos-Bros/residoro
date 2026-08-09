import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// tb-billing-invoice-generation-001 DoD verification:
//   1. The now-additive `brokerage_name` field on GET /admin/clients/:id/billing
//      actually reflects the real workspace name (not a placeholder).
//   2. Sets up one paid + one unpaid installment against the existing
//      tb-billing-installments-001 verify tenant so the InvoiceView route can
//      be exercised in a real browser for both status states.
// Requires the local backend dev server running (npm run dev, from
// application/backend) for the HTTP calls.
// Run via (from application/backend): npx tsx src/scripts/verify-billing-invoice-generation.ts
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;

const EXISTING_TENANT_ID = '05ed96db-2cb5-4d3f-bb80-e9f3e46b9e65'; // Mobile Verify Test Brokerage
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
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !OPERATOR_EMAIL || !OPERATOR_PASSWORD) {
    console.error('Missing required env vars -- see the top of this script for the full list.');
    process.exit(1);
  }

  const operatorSession = await signIn(OPERATOR_EMAIL, OPERATOR_PASSWORD);
  const authHeaders = {
    Authorization: `Bearer ${operatorSession.access_token}`,
    'Content-Type': 'application/json',
  };

  // Contract value distinct from tb-billing-installments-001's own
  // verification run so this run's assertions aren't accidentally satisfied
  // by leftover state.
  const putRes = await fetch(`${BACKEND_URL}/admin/clients/${EXISTING_TENANT_ID}/billing`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ contract_value: 180000, currency: 'PHP' }),
  });
  const putBody = await putRes.json();
  check('operator PUT /admin/clients/:id/billing succeeds', putRes.ok && putBody.contract_value === 180000, putBody);

  const unpaidRes = await fetch(`${BACKEND_URL}/admin/clients/${EXISTING_TENANT_ID}/billing/installments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ amount: 60000, currency: 'PHP', due_date: '2026-09-15' }),
  });
  const unpaidInstallment = await unpaidRes.json();
  check('created an unpaid installment', unpaidRes.ok && unpaidInstallment.status === 'unpaid', unpaidInstallment);

  const paidCreateRes = await fetch(`${BACKEND_URL}/admin/clients/${EXISTING_TENANT_ID}/billing/installments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ amount: 60000, currency: 'PHP', due_date: '2026-08-01' }),
  });
  const paidCreate = await paidCreateRes.json();
  const paidPatchRes = await fetch(
    `${BACKEND_URL}/admin/clients/${EXISTING_TENANT_ID}/billing/installments/${paidCreate.id}`,
    {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'paid', paid_date: '2026-08-05' }),
    },
  );
  const paidInstallment = await paidPatchRes.json();
  check(
    'created and marked a second installment paid',
    paidPatchRes.ok && paidInstallment.status === 'paid' && paidInstallment.paid_date === '2026-08-05',
    paidInstallment,
  );

  const getRes = await fetch(`${BACKEND_URL}/admin/clients/${EXISTING_TENANT_ID}/billing`, { headers: authHeaders });
  const getBody = await getRes.json();
  check(
    'GET now returns brokerage_name (non-empty string, not a placeholder)',
    getRes.ok && typeof getBody.brokerage_name === 'string' && getBody.brokerage_name.trim().length > 0,
    getBody,
  );
  check(
    'GET still returns the contract_billing + both installments just written',
    getBody.contract_billing?.contract_value === 180000 && getBody.installments.length === 2,
    getBody,
  );

  console.log('\nbrokerage_name:', getBody.brokerage_name);
  console.log('tenant_id:', EXISTING_TENANT_ID);
  console.log('unpaid installment_id:', unpaidInstallment.id, '-> /admin/clients/' + EXISTING_TENANT_ID + '/billing/installments/' + unpaidInstallment.id + '/invoice');
  console.log('paid installment_id:', paidInstallment.id, '-> /admin/clients/' + EXISTING_TENANT_ID + '/billing/installments/' + paidInstallment.id + '/invoice');

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
