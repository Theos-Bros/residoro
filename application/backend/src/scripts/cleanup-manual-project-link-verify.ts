import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Tears down everything setup-manual-project-link-verify.ts created, reading
// the ids back from the JSON file that script wrote. Deletion order matters:
// workspace_sharing_settings/workspace_performance_settings/workspace_
// matching_settings are auto-seeded per-tenant (trg_provision_workspace_
// settings_defaults, 20260728171500) with no ON DELETE CASCADE back to
// workspaces, so they must go before the workspace row itself.
// Run via: npx tsx src/scripts/cleanup-manual-project-link-verify.ts
async function main() {
  const idsPath = process.env.MANUAL_VERIFY_IDS_PATH ?? '/tmp/manual-project-link-verify-ids.json';
  const raw = await readFile(idsPath, 'utf-8');
  const ids = JSON.parse(raw) as {
    workspaceId: string;
    userId: string;
    contactId: string;
    projectId: string;
    propertyId: string;
  };

  const { error: propError } = await supabaseAdmin.from('properties').delete().eq('tenant_id', ids.workspaceId);
  if (propError) console.error(`cleanup: delete properties: ${propError.message}`);

  const { error: projError } = await supabaseAdmin.from('projects').delete().eq('id', ids.projectId);
  if (projError) console.error(`cleanup: delete project: ${projError.message}`);

  const { error: contactError } = await supabaseAdmin.from('contacts').delete().eq('id', ids.contactId);
  if (contactError) console.error(`cleanup: delete contact: ${contactError.message}`);

  for (const table of ['workspace_sharing_settings', 'workspace_performance_settings', 'workspace_matching_settings']) {
    const { error } = await supabaseAdmin.from(table).delete().eq('tenant_id', ids.workspaceId);
    if (error) console.error(`cleanup: delete ${table}: ${error.message}`);
  }

  const { error: wsError } = await supabaseAdmin.from('workspaces').delete().eq('id', ids.workspaceId);
  if (wsError) console.error(`cleanup: delete workspace: ${wsError.message}`);

  const { error: userError } = await supabaseAdmin.auth.admin.deleteUser(ids.userId);
  if (userError) console.error(`cleanup: delete user: ${userError.message}`);

  console.log(`Cleaned up workspace ${ids.workspaceId} (properties, project, contact, settings rows, user).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
