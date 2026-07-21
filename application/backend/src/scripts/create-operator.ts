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

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { app_role: 'operator' },
    redirectTo: `${frontendUrl}/accept-invite`,
  });

  if (error) {
    console.error('Failed to invite operator:', error.message);
    process.exit(1);
  }

  console.log(`Invited ${email} as an operator. They'll receive an email to set their password.`);
  console.log(`auth.users id: ${data.user?.id}`);
}

main();
