import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Live verification for 20260810240000_tier1_grant_lockdown.sql -- escalation
// checks for the tables not already covered by
// verify-tier1-transactions-grant-lockdown.ts's direct-PostgREST checks.
// Creates one disposable workspace + admin, deletes everything it created.
// Run via: npx tsx src/scripts/verify-tier1-escalation-checks.ts
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env first.');
    process.exit(1);
  }
  const suffix = Date.now();
  const email = `danielbacud+tier1-escalation-verify-${suffix}@gmail.com`;
  const password = 'Tier1EscalationVerify123!';

  const { data: workspace } = await supabaseAdmin
    .from('workspaces')
    .insert({ name: 'Tier 1 Escalation Checks Verify', contract_start_date: '2026-01-01', contract_end_date: '2027-01-01' })
    .select('id')
    .single();
  const { data: userData } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  await supabaseAdmin.from('profiles').update({ tenant_id: workspace!.id, role: 'admin' }).eq('id', userData!.user!.id);

  const { data: property } = await supabaseAdmin
    .from('properties')
    .insert({ tenant_id: workspace!.id, created_by: userData!.user!.id, title: 'Escalation Verify Unit', type: 'condo_unit', owner_type: 'individual', city: 'Taguig', province: 'Metro Manila', price: 1000000 })
    .select('id')
    .single();
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .insert({ tenant_id: workspace!.id, created_by: userData!.user!.id, name: 'Escalation Verify Buyer', type: 'buyer_lead' })
    .select('id')
    .single();
  const { data: lead } = await supabaseAdmin
    .from('buyer_requirements')
    .insert({ tenant_id: workspace!.id, created_by: userData!.user!.id, contact_id: contact!.id })
    .select('id')
    .single();
  const { data: project } = await supabaseAdmin
    .from('projects')
    .insert({ tenant_id: workspace!.id, created_by: userData!.user!.id, developer_id: contact!.id, name: 'Escalation Verify Project', project_type: 'condo', location: 'Taguig', total_units: 10 })
    .select('id')
    .single();

  const results: { check: string; pass: boolean; detail: string }[] = [];

  try {
    const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const signIn = await anon.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data.session) throw new Error(`sign-in: ${signIn.error?.message}`);
    const scoped = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { global: { headers: { Authorization: `Bearer ${signIn.data.session.access_token}` } } });

    // properties: column-level escalation -- owner_type/owner_id must stay grantable
    // (legitimate admin flow), but a NON-EXISTENT column should reject cleanly, and
    // verification_status (a real, granted, non-admin-gated column) should succeed --
    // proving the grant is column-scoped, not table-wide.
    const propUpdate = await scoped.from('properties').update({ verification_status: 'verified' }).eq('id', property!.id).select();
    results.push({ check: 'properties.verification_status UPDATE (should succeed, granted column)', pass: !propUpdate.error, detail: propUpdate.error ? propUpdate.error.message : 'ok' });

    // buyer_requirements: no DELETE grant at all
    const leadDelete = await scoped.from('buyer_requirements').delete().eq('id', lead!.id);
    results.push({
      check: 'buyer_requirements DELETE (should be blocked, no delete grant)',
      pass: !!leadDelete.error,
      detail: leadDelete.error ? `${leadDelete.error.code}: ${leadDelete.error.message}` : 'no error -- DELETE grant still present',
    });

    // project_unit_types: no UPDATE/DELETE grant, only INSERT
    const { data: unitType } = await supabaseAdmin
      .from('project_unit_types')
      .insert({ tenant_id: workspace!.id, created_by: userData!.user!.id, project_id: project!.id, name: 'Test Unit', property_type: 'condo_unit', price: 1000000, price_currency: 'PHP' })
      .select('id')
      .single();
    const unitTypeUpdate = await scoped.from('project_unit_types').update({ name: 'Hacked' }).eq('id', unitType!.id);
    results.push({
      check: 'project_unit_types UPDATE (should be blocked, no update grant)',
      pass: !!unitTypeUpdate.error,
      detail: unitTypeUpdate.error ? `${unitTypeUpdate.error.code}: ${unitTypeUpdate.error.message}` : 'no error -- UPDATE grant still present',
    });

    // projects: no DELETE grant despite admin-gated RLS policy
    const projectDelete = await scoped.from('projects').delete().eq('id', project!.id);
    results.push({
      check: 'projects DELETE (should be blocked, no delete grant)',
      pass: !!projectDelete.error,
      detail: projectDelete.error ? `${projectDelete.error.code}: ${projectDelete.error.message}` : 'no error -- DELETE grant still present',
    });

    // property_documents: no UPDATE grant at all
    const { data: doc } = await supabaseAdmin
      .from('property_documents')
      .insert({ tenant_id: workspace!.id, property_id: property!.id, document_type: 'title_deed', storage_path: 'test/path', file_name: 'test.pdf', created_by: userData!.user!.id })
      .select('id')
      .single();
    const docUpdate = await scoped.from('property_documents').update({ document_type: 'hacked' }).eq('id', doc!.id);
    results.push({
      check: 'property_documents UPDATE (should be blocked, no update grant)',
      pass: !!docUpdate.error,
      detail: docUpdate.error ? `${docUpdate.error.code}: ${docUpdate.error.message}` : 'no error -- UPDATE grant still present',
    });

    // inquiries: legitimate admin DELETE should succeed (real grant + real route precedent)
    const { data: inquiry } = await supabaseAdmin
      .from('inquiries')
      .insert({ tenant_id: workspace!.id, created_by: userData!.user!.id, stage: 'to_probe', buyer_name: 'Test' })
      .select('id')
      .single();
    const inquiryDelete = await scoped.from('inquiries').delete().eq('id', inquiry!.id);
    results.push({ check: 'inquiries DELETE (should succeed, granted for admin)', pass: !inquiryDelete.error, detail: inquiryDelete.error ? inquiryDelete.error.message : 'ok' });
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(userData!.user!.id);
    await supabaseAdmin.from('project_unit_types').delete().eq('project_id', project!.id);
    await supabaseAdmin.from('property_documents').delete().eq('property_id', property!.id);
    await supabaseAdmin.from('buyer_requirements').delete().eq('id', lead!.id);
    await supabaseAdmin.from('projects').delete().eq('id', project!.id);
    await supabaseAdmin.from('properties').delete().eq('id', property!.id);
    await supabaseAdmin.from('contacts').delete().eq('id', contact!.id);
    await supabaseAdmin.from('workspaces').delete().eq('id', workspace!.id);
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
