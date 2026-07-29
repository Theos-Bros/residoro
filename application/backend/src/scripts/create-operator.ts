import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Run via: npm run create-operator -- --email someone@example.com
// This is the ONLY way an operator account gets created -- there is no
// public signup endpoint for this at all (see tb-client-lifecycle-
// operator-access-001's Context for why that's a stronger boundary than a
// passcode-gated form would be). Only someone holding the service-role key
// (this script requires SUPABASE_SERVICE_ROLE_KEY) can run it.
function parseEmailArg(): string {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf('--email');
  const email = flagIndex !== -1 ? args[flagIndex + 1] : undefined;

  if (!email) {
    console.error('Usage: npm run create-operator -- --email someone@example.com');
    process.exit(1);
  }

  return email;
}

async function main() {
  const email = parseEmailArg();
  const frontendUrl = process.env.FRONTEND_URL;

  if (!frontendUrl) {
    console.error('FRONTEND_URL must be set (see .env.example).');
    process.exit(1);
  }

  // 2026-07-29 security review: app_role must never travel through
  // inviteUserByEmail's `data` option -- that maps to raw_user_meta_data,
  // the same field Supabase Auth's public POST /auth/v1/signup lets ANY
  // caller set, which is exactly how self-granting the operator role was
  // possible. handle_new_user() now always creates an inert profile; the
  // real role assignment happens here, immediately after, keyed by the
  // invite response's own trusted user id.
  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${frontendUrl}/accept-invite`,
  });

  if (error || !data.user) {
    console.error('Failed to invite operator:', error?.message ?? 'unknown error');
    process.exit(1);
  }

  const { error: assignError } = await supabaseAdmin
    .from('profiles')
    .update({ role: 'operator' })
    .eq('id', data.user.id);

  if (assignError) {
    console.error('Invited the user but failed to assign the operator role:', assignError.message);
    process.exit(1);
  }

  console.log(`Invited ${email} as an operator. They'll receive an email to set their password.`);
  console.log(`auth.users id: ${data.user.id}`);
}

main();
