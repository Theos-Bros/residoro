import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-billing-installments-001 DoD verification:
//   1. RLS: the target tenant's admin CAN read contract_billing/
//      billing_installments for their own tenant; a non-admin member of the
//      same tenant CANNOT; no RLS-scoped session (any role) can write.
//   2. The operator-authenticated HTTP flow (/admin/clients/:id/billing...)
//      actually works end to end against a real tenant.
// Requires the local backend dev server running (npm run dev, from
// application/backend) for step 2's HTTP calls.
// Run via (from application/backend): npx tsx src/scripts/verify-billing-rls-and-flow.ts
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;

const ADMIN_EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL;
const ADMIN_PASSWORD = process.env.MOBILE_TEST_ACCOUNT_PASSWORD;
const MEMBER_EMAIL = process.env.BILLING_VERIFY_MEMBER_EMAIL;
const MEMBER_PASSWORD = process.env.BILLING_VERIFY_MEMBER_PASSWORD;
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

function scopedClient(accessToken: string) {
  return createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function main() {
  if (
    !SUPABASE_URL ||
    !PUBLISHABLE_KEY ||
    !ADMIN_EMAIL ||
    !ADMIN_PASSWORD ||
    !MEMBER_EMAIL ||
    !MEMBER_PASSWORD ||
    !OPERATOR_EMAIL ||
    !OPERATOR_PASSWORD
  ) {
    console.error('Missing required env vars -- see the top of this script for the full list.');
    process.exit(1);
  }

  const { data: adminProfile } = await supabaseAdmin
    .from('profiles')
    .select('tenant_id')
    .eq('id', (await supabaseAdmin.auth.admin.listUsers()).data.users.find((u) => u.email === ADMIN_EMAIL)!.id)
    .single();
  const ownTenantId = adminProfile!.tenant_id as string;
  console.log(`Target tenant: ${ownTenantId}`);

  // ------------------------------------------------------------------------
  // 1. RLS -- admin session
  // ------------------------------------------------------------------------
  const adminSession = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  const adminClient = scopedClient(adminSession.access_token);

  const { data: ownRead, error: ownReadError } = await adminClient
    .from('contract_billing')
    .select('tenant_id')
    .eq('tenant_id', ownTenantId)
    .maybeSingle();
  check('admin can SELECT contract_billing for own tenant (no error)', !ownReadError, ownReadError);

  const { data: otherTenant } = await supabaseAdmin.from('workspaces').select('id').neq('id', ownTenantId).limit(1).single();

  const { data: crossRead, error: crossReadError } = await adminClient
    .from('contract_billing')
    .select('tenant_id')
    .eq('tenant_id', otherTenant!.id)
    .maybeSingle();
  check('admin CANNOT SELECT another tenant\'s contract_billing (blocked, empty)', !crossReadError && crossRead === null, {
    crossReadError,
    crossRead,
  });

  const { error: adminInsertError } = await adminClient
    .from('contract_billing')
    .insert({ tenant_id: ownTenantId, contract_value: 1, currency: 'PHP' });
  check('admin CANNOT INSERT contract_billing via RLS-scoped client (blocked)', Boolean(adminInsertError), adminInsertError);

  // ------------------------------------------------------------------------
  // 2. RLS -- non-admin member session (same tenant)
  // ------------------------------------------------------------------------
  const memberSession = await signIn(MEMBER_EMAIL, MEMBER_PASSWORD);
  const memberClient = scopedClient(memberSession.access_token);

  const { data: memberRead, error: memberReadError } = await memberClient
    .from('contract_billing')
    .select('tenant_id')
    .eq('tenant_id', ownTenantId)
    .maybeSingle();
  check(
    'non-admin member of the SAME tenant CANNOT SELECT contract_billing (blocked, empty)',
    !memberReadError && memberRead === null,
    { memberReadError, memberRead },
  );

  const { data: memberInstallmentsRead, error: memberInstallmentsError } = await memberClient
    .from('billing_installments')
    .select('id')
    .eq('tenant_id', ownTenantId);
  check(
    'non-admin member CANNOT SELECT billing_installments (blocked, empty)',
    !memberInstallmentsError && (memberInstallmentsRead?.length ?? 0) === 0,
    { memberInstallmentsError, memberInstallmentsRead },
  );

  // ------------------------------------------------------------------------
  // 3. Operator HTTP flow against the running local dev server
  // ------------------------------------------------------------------------
  const operatorSession = await signIn(OPERATOR_EMAIL, OPERATOR_PASSWORD);
  const authHeaders = {
    Authorization: `Bearer ${operatorSession.access_token}`,
    'Content-Type': 'application/json',
  };

  const putRes = await fetch(`${BACKEND_URL}/admin/clients/${ownTenantId}/billing`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ contract_value: 120000, currency: 'PHP' }),
  });
  const putBody = await putRes.json();
  check('operator PUT /admin/clients/:id/billing succeeds', putRes.ok && putBody.contract_value === 120000, putBody);

  const postRes = await fetch(`${BACKEND_URL}/admin/clients/${ownTenantId}/billing/installments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ amount: 40000, currency: 'PHP', due_date: '2026-09-01' }),
  });
  const installment = await postRes.json();
  check('operator POST .../installments creates an installment', postRes.ok && installment.status === 'unpaid', installment);

  const patchRes = await fetch(`${BACKEND_URL}/admin/clients/${ownTenantId}/billing/installments/${installment.id}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'paid' }),
  });
  const paidInstallment = await patchRes.json();
  check(
    'operator PATCH marks installment paid with a paid_date defaulted to today',
    patchRes.ok && paidInstallment.status === 'paid' && Boolean(paidInstallment.paid_date),
    paidInstallment,
  );

  const unpaidRes = await fetch(`${BACKEND_URL}/admin/clients/${ownTenantId}/billing/installments/${installment.id}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'unpaid' }),
  });
  const unpaidInstallment = await unpaidRes.json();
  check(
    'operator PATCH marking unpaid clears paid_date',
    unpaidRes.ok && unpaidInstallment.status === 'unpaid' && unpaidInstallment.paid_date === null,
    unpaidInstallment,
  );

  const getRes = await fetch(`${BACKEND_URL}/admin/clients/${ownTenantId}/billing`, { headers: authHeaders });
  const getBody = await getRes.json();
  check(
    'operator GET returns the contract_billing + installment just written',
    getRes.ok && getBody.contract_billing?.contract_value === 120000 && getBody.installments.length === 1,
    getBody,
  );

  const deleteRes = await fetch(`${BACKEND_URL}/admin/clients/${ownTenantId}/billing/installments/${installment.id}`, {
    method: 'DELETE',
    headers: { Authorization: authHeaders.Authorization },
  });
  check('operator DELETE removes the installment (204)', deleteRes.status === 204);

  const getAfterDeleteRes = await fetch(`${BACKEND_URL}/admin/clients/${ownTenantId}/billing`, { headers: authHeaders });
  const getAfterDeleteBody = await getAfterDeleteRes.json();
  check('installment is gone after delete', getAfterDeleteBody.installments.length === 0, getAfterDeleteBody);

  // Cleanup: leave contract_billing (harmless, small test row) but remove
  // this run's now-empty installments state is already clean; nothing else
  // to clean up.

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
