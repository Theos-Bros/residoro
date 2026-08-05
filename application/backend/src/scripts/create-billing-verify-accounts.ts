import 'dotenv/config';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// One-off throwaway-account script for tb-billing-installments-001's live
// verification. handle_new_user() (post 2026-07-29 security fix) always
// creates an inert profile (role: member, tenant_id: null) regardless of
// signup metadata -- so privilege here is granted the same trusted way
// POST /admin/clients does it: createUser with NO metadata, then a direct
// service-role UPDATE on profiles keyed by the new user's own id.
// Run via (from application/backend): npx tsx src/scripts/create-billing-verify-accounts.ts
const EXISTING_TENANT_ID = '05ed96db-2cb5-4d3f-bb80-e9f3e46b9e65'; // Mobile Verify Test Brokerage
const MEMBER_EMAIL = 'danielbacud+billing-verify-member@gmail.com';
const OPERATOR_EMAIL = 'danielbacud+billing-verify-operator@gmail.com';

function randomPassword() {
  return crypto.randomBytes(18).toString('base64url');
}

async function createUser(email: string) {
  const password = randomPassword();
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Could not create ${email}: ${error?.message}`);
  }
  return { id: data.user.id, email, password };
}

async function main() {
  const member = await createUser(MEMBER_EMAIL);
  const { error: memberError } = await supabaseAdmin
    .from('profiles')
    .update({ tenant_id: EXISTING_TENANT_ID, role: 'member' })
    .eq('id', member.id);
  if (memberError) {
    throw new Error(`Could not assign member profile: ${memberError.message}`);
  }

  const operator = await createUser(OPERATOR_EMAIL);
  const { error: operatorError } = await supabaseAdmin.from('profiles').update({ role: 'operator' }).eq('id', operator.id);
  if (operatorError) {
    throw new Error(`Could not assign operator profile: ${operatorError.message}`);
  }

  console.log(JSON.stringify({ member, operator, tenant_id: EXISTING_TENANT_ID }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
