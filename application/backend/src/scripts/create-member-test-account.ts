import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Creates a persistent (not cleaned up) member-role test account in the same
// tenant as MOBILE_TEST_ACCOUNT_EMAIL, for manual UI testing of member-level
// (and delegated) access -- mirrors the temp-member pattern used by the
// verify-*.ts scripts, but this one is meant to be kept.
const ADMIN_EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL!;
const MEMBER_EMAIL = 'danielbacud+residoro-member-verify@gmail.com';
const MEMBER_PASSWORD = 'ResidoroMemberVerify123!';

async function main() {
  const { data: adminUser } = await supabaseAdmin.auth.admin.listUsers();
  const admin = adminUser.users.find((u) => u.email === ADMIN_EMAIL);
  if (!admin) throw new Error(`Could not find admin test account ${ADMIN_EMAIL}`);

  const { data: adminProfile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', admin.id).single();
  const tenantId = adminProfile!.tenant_id;

  const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
  const existing = existingUsers.users.find((u) => u.email === MEMBER_EMAIL);
  if (existing) {
    await supabaseAdmin
      .from('profiles')
      .update({ tenant_id: tenantId, role: 'member', full_name: 'Test Member' })
      .eq('id', existing.id);
    console.log(`Member account already existed (${existing.id}) -- repointed at tenant ${tenantId}.`);
    console.log(`Email: ${MEMBER_EMAIL}`);
    console.log(`Password: ${MEMBER_PASSWORD}`);
    return;
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: MEMBER_EMAIL,
    password: MEMBER_PASSWORD,
    email_confirm: true,
  });
  if (createError || !created.user) throw new Error(`Could not create member account: ${createError?.message}`);

  // handle_new_user() auto-provisions a brand-new workspace + admin profile
  // for every signup -- repoint that row at the real test tenant as a
  // non-admin member, and delete the leftover throwaway workspace it created.
  const { data: autoProfile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', created.user.id).single();
  const leftoverWorkspaceId = autoProfile!.tenant_id;

  await supabaseAdmin
    .from('profiles')
    .update({ tenant_id: tenantId, role: 'member', full_name: 'Test Member' })
    .eq('id', created.user.id);
  await supabaseAdmin.from('workspaces').delete().eq('id', leftoverWorkspaceId);

  console.log(`Created member account ${created.user.id} in tenant ${tenantId}.`);
  console.log(`Email: ${MEMBER_EMAIL}`);
  console.log(`Password: ${MEMBER_PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
