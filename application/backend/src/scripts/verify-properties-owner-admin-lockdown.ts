import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Live verification for 20260810250000_properties_owner_admin_lockdown.sql
// (tb-properties-owner-admin-lockdown-001). Creates one disposable workspace
// with an admin and a non-admin member, a property, and two candidate owner
// contacts. Confirms:
//   1. A non-admin's direct PostgREST attempt to change owner_type/owner_id
//      is rejected (42501) -- the escalation path this trigger closes.
//   2. The legitimate admin flow (changing owner_type/owner_id as an admin)
//      still succeeds unchanged -- no regression on PATCH /properties/:id.
//   3. A non-admin editing an unrelated column (price) is completely
//      unaffected by the trigger.
// Deletes everything it created afterward.
// Run via: npx tsx src/scripts/verify-properties-owner-admin-lockdown.ts
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env first.');
    process.exit(1);
  }

  const suffix = Date.now();
  const adminEmail = `danielbacud+owner-lockdown-admin-${suffix}@gmail.com`;
  const memberEmail = `danielbacud+owner-lockdown-member-${suffix}@gmail.com`;
  const password = 'OwnerLockdownVerify123!';

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({ name: 'Owner Admin Lockdown Verify', contract_start_date: '2026-01-01', contract_end_date: '2027-01-01' })
    .select('id')
    .single();
  if (workspaceError || !workspace) {
    console.error('workspace create failed:', workspaceError?.message);
    process.exit(1);
  }

  const { data: adminUserData, error: adminUserError } = await supabaseAdmin.auth.admin.createUser({
    email: adminEmail,
    password,
    email_confirm: true,
  });
  const { data: memberUserData, error: memberUserError } = await supabaseAdmin.auth.admin.createUser({
    email: memberEmail,
    password,
    email_confirm: true,
  });
  if (adminUserError || !adminUserData.user || memberUserError || !memberUserData.user) {
    console.error('user create failed:', adminUserError?.message, memberUserError?.message);
    process.exit(1);
  }

  await supabaseAdmin.from('profiles').update({ tenant_id: workspace.id, role: 'admin' }).eq('id', adminUserData.user.id);
  await supabaseAdmin.from('profiles').update({ tenant_id: workspace.id, role: 'member' }).eq('id', memberUserData.user.id);

  const { data: contact1 } = await supabaseAdmin
    .from('contacts')
    .insert({ tenant_id: workspace.id, created_by: adminUserData.user.id, name: 'Owner Lockdown Verify Owner 1', type: 'buyer_lead' })
    .select('id')
    .single();
  const { data: contact2 } = await supabaseAdmin
    .from('contacts')
    .insert({ tenant_id: workspace.id, created_by: adminUserData.user.id, name: 'Owner Lockdown Verify Owner 2', type: 'buyer_lead' })
    .select('id')
    .single();

  const { data: property, error: propertyError } = await supabaseAdmin
    .from('properties')
    .insert({
      tenant_id: workspace.id,
      created_by: adminUserData.user.id,
      title: 'Owner Lockdown Verify Unit',
      type: 'condo_unit',
      owner_type: 'individual',
      owner_id: contact1!.id,
      city: 'Taguig',
      province: 'Metro Manila',
      price: 1000000,
    })
    .select('id')
    .single();
  if (propertyError || !property) {
    console.error('property create failed:', propertyError?.message);
    process.exit(1);
  }

  const results: { check: string; pass: boolean; detail: string }[] = [];

  try {
    const memberAnon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const memberSignIn = await memberAnon.auth.signInWithPassword({ email: memberEmail, password });
    if (memberSignIn.error || !memberSignIn.data.session) throw new Error(`member sign-in: ${memberSignIn.error?.message}`);
    const memberScoped = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${memberSignIn.data.session.access_token}` } },
    });

    const adminAnon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const adminSignIn = await adminAnon.auth.signInWithPassword({ email: adminEmail, password });
    if (adminSignIn.error || !adminSignIn.data.session) throw new Error(`admin sign-in: ${adminSignIn.error?.message}`);
    const adminScoped = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${adminSignIn.data.session.access_token}` } },
    });

    // 1. Non-admin direct PostgREST attempt to change ownership -- should be
    // rejected by the new trigger (42501), even though the column is still
    // grantable to `authenticated`.
    const memberOwnerWrite = await memberScoped
      .from('properties')
      .update({ owner_type: 'company', owner_id: contact2!.id })
      .eq('id', property.id)
      .select();
    results.push({
      check: 'non-admin UPDATE owner_type/owner_id (should be rejected, 42501)',
      pass: !!memberOwnerWrite.error && memberOwnerWrite.error.code === '42501',
      detail: memberOwnerWrite.error
        ? `${memberOwnerWrite.error.code}: ${memberOwnerWrite.error.message}`
        : `no error -- escalation succeeded, rows: ${memberOwnerWrite.data?.length}`,
    });

    // Confirm ownership was actually untouched by the rejected write above.
    const { data: afterMemberAttempt } = await supabaseAdmin
      .from('properties')
      .select('owner_type, owner_id')
      .eq('id', property.id)
      .single();
    results.push({
      check: 'ownership unchanged after rejected non-admin write',
      pass: afterMemberAttempt?.owner_type === 'individual' && afterMemberAttempt?.owner_id === contact1!.id,
      detail: JSON.stringify(afterMemberAttempt),
    });

    // 2. Non-admin editing an unrelated column (price) -- should be
    // completely unaffected by the trigger.
    const memberPriceWrite = await memberScoped
      .from('properties')
      .update({ price: 2000000 })
      .eq('id', property.id)
      .select('price');
    results.push({
      check: 'non-admin UPDATE price, unrelated column (should succeed)',
      pass: !memberPriceWrite.error && memberPriceWrite.data?.[0]?.price === 2000000,
      detail: memberPriceWrite.error ? memberPriceWrite.error.message : JSON.stringify(memberPriceWrite.data),
    });

    // 3. Legitimate admin flow -- changing owner_type/owner_id as an admin
    // should still succeed unchanged (mirrors PATCH /properties/:id).
    const adminOwnerWrite = await adminScoped
      .from('properties')
      .update({ owner_type: 'company', owner_id: contact2!.id })
      .eq('id', property.id)
      .select('owner_type, owner_id');
    results.push({
      check: 'admin UPDATE owner_type/owner_id (should succeed, no regression)',
      pass:
        !adminOwnerWrite.error &&
        adminOwnerWrite.data?.[0]?.owner_type === 'company' &&
        adminOwnerWrite.data?.[0]?.owner_id === contact2!.id,
      detail: adminOwnerWrite.error ? adminOwnerWrite.error.message : JSON.stringify(adminOwnerWrite.data),
    });
  } finally {
    // Order matters: properties/contacts.created_by is a plain (no-cascade)
    // FK to auth.users(id), so the rows referencing a user as created_by
    // must be deleted before that user, or the auth deletion fails silently
    // and leaves the workspace/profile behind too (FK from profiles). Same
    // reason the per-tenant settings tables (auto-provisioned by
    // provision_workspace_settings_defaults(), a plain no-cascade FK to
    // workspaces(id)) must be cleared before the workspace itself.
    await supabaseAdmin.from('properties').delete().eq('id', property.id);
    await supabaseAdmin.from('contacts').delete().eq('id', contact1!.id);
    await supabaseAdmin.from('contacts').delete().eq('id', contact2!.id);
    await supabaseAdmin.auth.admin.deleteUser(adminUserData.user.id);
    await supabaseAdmin.auth.admin.deleteUser(memberUserData.user.id);
    for (const table of [
      'workspace_sharing_settings',
      'workspace_performance_settings',
      'workspace_matching_settings',
      'workspace_commission_settings',
      'workspace_itinerary_settings',
    ]) {
      await supabaseAdmin.from(table).delete().eq('tenant_id', workspace.id);
    }
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
