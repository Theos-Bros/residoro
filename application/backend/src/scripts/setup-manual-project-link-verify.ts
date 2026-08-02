import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// One-off setup for a manual browser walkthrough of tb-properties-project-
// link-001's frontend DoD item ("Add existing unit" on ProjectDetailPage).
// Creates a throwaway tenant + admin + developer + project + one
// developer-owned, not-yet-linked property, and prints everything needed to
// log in and find the project in the UI. Pair with
// cleanup-manual-project-link-verify.ts afterward -- this script writes the
// created ids to manual-project-link-verify-ids.json (scratchpad-like, not
// committed) so cleanup doesn't need them retyped.
//
// Run via: npx tsx src/scripts/setup-manual-project-link-verify.ts
const EMAIL = process.env.PROJECT_LINK_VERIFY_ACCOUNT_A_EMAIL;
const PASSWORD = process.env.PROJECT_LINK_VERIFY_ACCOUNT_A_PASSWORD;

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Set PROJECT_LINK_VERIFY_ACCOUNT_A_EMAIL/PASSWORD in .env first.');
    process.exit(1);
  }

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({
      name: 'Project Link Manual Verify Tenant',
      contract_start_date: '2026-01-01',
      contract_end_date: '2027-01-01',
    })
    .select('id')
    .single();
  if (workspaceError || !workspace) throw new Error(`create workspace: ${workspaceError?.message}`);

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userError || !userData.user) throw new Error(`create user: ${userError?.message}`);

  const { error: assignError } = await supabaseAdmin
    .from('profiles')
    .update({ tenant_id: workspace.id, role: 'admin' })
    .eq('id', userData.user.id);
  if (assignError) throw new Error(`assign admin: ${assignError.message}`);

  const suffix = Date.now();

  const { data: developer, error: developerError } = await supabaseAdmin
    .from('contacts')
    .insert({
      tenant_id: workspace.id,
      created_by: userData.user.id,
      name: `Manual Verify Developer ${suffix}`,
      type: 'developer',
      is_company: true,
    })
    .select('id')
    .single();
  if (developerError || !developer) throw new Error(`create developer: ${developerError?.message}`);

  const { data: project, error: projectError } = await supabaseAdmin
    .from('projects')
    .insert({
      tenant_id: workspace.id,
      developer_id: developer.id,
      name: `Manual Verify Project ${suffix}`,
      project_type: 'condo',
      status: 'pre_selling',
    })
    .select('id')
    .single();
  if (projectError || !project) throw new Error(`create project: ${projectError?.message}`);

  const { data: property, error: propertyError } = await supabaseAdmin
    .from('properties')
    .insert({
      tenant_id: workspace.id,
      created_by: userData.user.id,
      title: `Manual Verify Unlinked Unit ${suffix}`,
      type: 'condo_unit',
      owner_type: 'developer',
      city: 'Taguig',
      province: 'Metro Manila',
      price: 5000000,
    })
    .select('id, title')
    .single();
  if (propertyError || !property) throw new Error(`create property: ${propertyError?.message}`);

  const ids = {
    workspaceId: workspace.id,
    userId: userData.user.id,
    contactId: developer.id,
    projectId: project.id,
    propertyId: property.id,
  };

  const fs = await import('node:fs/promises');
  const idsPath = process.env.MANUAL_VERIFY_IDS_PATH ?? '/tmp/manual-project-link-verify-ids.json';
  await fs.writeFile(idsPath, JSON.stringify(ids, null, 2));

  console.log('Created throwaway tenant for manual browser verification:');
  console.log(`  Login: ${EMAIL} / ${PASSWORD}`);
  console.log(`  Project id: ${project.id} -> visit /projects/${project.id}`);
  console.log(`  Unlinked property (developer-owned): "${property.title}" (id ${property.id})`);
  console.log(`\nIds written to ${idsPath} for cleanup.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
