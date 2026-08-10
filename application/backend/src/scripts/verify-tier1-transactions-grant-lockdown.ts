import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Live verification for 20260810240000_tier1_grant_lockdown.sql's four
// transaction tables (contracts, closings, offers, viewings) -- the highest-
// value Tier 1 tables and the ones with no existing end-to-end coverage
// through their real HTTP routes. Exercises the full deal flow through the
// actual backend (POST /viewings, POST/PATCH /offers, POST/PATCH /contracts,
// POST/PATCH /closings), then confirms the escalation paths the grant
// lockdown closed are rejected via direct PostgREST. Creates one disposable
// workspace + admin, deletes everything it created.
// Run via (with `npx tsx src/index.ts` already running in another terminal):
// npx tsx src/scripts/verify-tier1-transactions-grant-lockdown.ts
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const BACKEND_URL = process.env.BACKEND_VERIFY_URL ?? 'http://localhost:4000';

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env first.');
    process.exit(1);
  }

  const suffix = Date.now();
  const email = `danielbacud+tier1-txn-verify-${suffix}@gmail.com`;
  const password = 'Tier1TxnVerify123!';

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({ name: 'Tier 1 Transactions Grant Lockdown Verify', contract_start_date: '2026-01-01', contract_end_date: '2027-01-01' })
    .select('id')
    .single();
  if (workspaceError || !workspace) {
    console.error('workspace create failed:', workspaceError?.message);
    process.exit(1);
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (userError || !userData.user) {
    console.error('user create failed:', userError?.message);
    await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
    process.exit(1);
  }
  await supabaseAdmin.from('profiles').update({ tenant_id: workspace.id, role: 'admin' }).eq('id', userData.user.id);

  const { data: property } = await supabaseAdmin
    .from('properties')
    .insert({
      tenant_id: workspace.id,
      created_by: userData.user.id,
      title: 'Tier 1 Txn Verify Unit',
      type: 'condo_unit',
      owner_type: 'individual',
      city: 'Taguig',
      province: 'Metro Manila',
      price: 3000000,
    })
    .select('id')
    .single();
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .insert({ tenant_id: workspace.id, property_id: property!.id, agent_id: userData.user.id, listing_type: 'sale', price: 3000000, status: 'active' })
    .select('id')
    .single();
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .insert({ tenant_id: workspace.id, created_by: userData.user.id, name: 'Tier 1 Txn Verify Buyer', type: 'buyer_lead' })
    .select('id')
    .single();
  const { data: lead } = await supabaseAdmin
    .from('buyer_requirements')
    .insert({ tenant_id: workspace.id, created_by: userData.user.id, contact_id: contact!.id })
    .select('id')
    .single();

  const results: { check: string; pass: boolean; detail: string }[] = [];
  let contractId: string | undefined;

  try {
    const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const signIn = await anon.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data.session) throw new Error(`sign-in: ${signIn.error?.message}`);
    const token = signIn.data.session.access_token;
    const scoped = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });

    async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      });
      return { status: res.status, body: await res.json().catch(() => undefined) };
    }

    // --- viewings ---
    const viewingRes = await call('/viewings', {
      method: 'POST',
      body: JSON.stringify({ buyer_requirement_id: lead!.id, listing_id: listing!.id, scheduled_at: new Date().toISOString() }),
    });
    results.push({ check: 'POST /viewings (legitimate)', pass: viewingRes.status === 201, detail: JSON.stringify(viewingRes.body) });
    const viewingId = viewingRes.body?.id;
    const viewingPatch = await call(`/viewings/${viewingId}`, { method: 'PATCH', body: JSON.stringify({ outcome: 'completed', feedback: 'Liked it' }) });
    results.push({ check: 'PATCH /viewings/:id (legitimate)', pass: viewingPatch.status === 200, detail: JSON.stringify(viewingPatch.body) });

    // --- offers ---
    const offerRes = await call('/offers', {
      method: 'POST',
      body: JSON.stringify({ buyer_requirement_id: lead!.id, listing_id: listing!.id, offered_by: 'buyer', amount: 2900000 }),
    });
    results.push({ check: 'POST /offers (legitimate)', pass: offerRes.status === 201, detail: JSON.stringify(offerRes.body) });
    const offerId = offerRes.body?.id;
    const offerAccept = await call(`/offers/${offerId}`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }) });
    results.push({ check: 'PATCH /offers/:id accept (legitimate)', pass: offerAccept.status === 200, detail: JSON.stringify(offerAccept.body) });

    // --- contracts ---
    const contractRes = await call('/contracts', { method: 'POST', body: JSON.stringify({ offer_id: offerId }) });
    results.push({ check: 'POST /contracts (legitimate)', pass: contractRes.status === 201, detail: JSON.stringify(contractRes.body) });
    contractId = contractRes.body?.id;
    const contractSent = await call(`/contracts/${contractId}`, { method: 'PATCH', body: JSON.stringify({ signing_status: 'sent' }) });
    results.push({ check: 'PATCH /contracts/:id -> sent (legitimate)', pass: contractSent.status === 200, detail: JSON.stringify(contractSent.body) });
    const contractSigned = await call(`/contracts/${contractId}`, { method: 'PATCH', body: JSON.stringify({ signing_status: 'signed' }) });
    results.push({ check: 'PATCH /contracts/:id -> signed (legitimate)', pass: contractSigned.status === 200, detail: JSON.stringify(contractSigned.body) });

    // --- closings ---
    const closingRes = await call('/closings', { method: 'POST', body: JSON.stringify({ contract_id: contractId }) });
    results.push({ check: 'POST /closings (legitimate)', pass: closingRes.status === 201, detail: JSON.stringify(closingRes.body) });
    const closingId = closingRes.body?.id;
    const closingComplete = await call(`/closings/${closingId}`, { method: 'PATCH', body: JSON.stringify({ completed: true, checklist_state: { keys_handed_over: true } }) });
    results.push({ check: 'PATCH /closings/:id complete (legitimate)', pass: closingComplete.status === 200, detail: JSON.stringify(closingComplete.body) });

    // --- escalation checks: direct PostgREST against the grant lockdown ---
    const contractDelete = await scoped.from('contracts').delete().eq('id', contractId ?? '00000000-0000-0000-0000-000000000000');
    results.push({
      check: 'contracts DELETE via direct PostgREST (should be blocked, no delete grant)',
      pass: !!contractDelete.error,
      detail: contractDelete.error ? `${contractDelete.error.code}: ${contractDelete.error.message}` : 'no error -- DELETE grant still present',
    });

    const closingTenantEscalation = await scoped
      .from('closings')
      .update({ tenant_id: '00000000-0000-0000-0000-000000000000' })
      .eq('id', closingId ?? '00000000-0000-0000-0000-000000000000');
    results.push({
      check: 'closings.tenant_id UPDATE via direct PostgREST (should be blocked, not a granted column)',
      pass: !!closingTenantEscalation.error,
      detail: closingTenantEscalation.error
        ? `${closingTenantEscalation.error.code}: ${closingTenantEscalation.error.message}`
        : 'no error -- tenant_id column grant still present',
    });

    const propertiesDelete = await scoped.from('properties').delete().eq('id', '00000000-0000-0000-0000-000000000000');
    // properties DOES have a legitimate delete grant (unit removal route) -- this call targets a
    // non-existent row, so success here just means the grant exists (0 rows affected, no error).
    results.push({
      check: 'properties DELETE via direct PostgREST (grant exists, targets a non-existent row -- should be permitted, 0 rows affected)',
      pass: !propertiesDelete.error,
      detail: propertiesDelete.error ? `${propertiesDelete.error.code}: ${propertiesDelete.error.message}` : 'no error, as expected',
    });
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(userData.user.id);
    await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
  }

  let allPass = true;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} - ${r.check} (${r.detail})`);
    if (!r.pass) allPass = false;
  }
  console.log(allPass ? `\n${results.length}/${results.length} checks pass` : '\nSOME CHECKS FAILED');
  process.exit(allPass ? 0 : 1);
}

main();
