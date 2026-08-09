import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// tb-user-profile-email-prefix-001 DoD verification:
//   1. GET /me/profile returns the caller's real login email (from the
//      verified Auth token, never a profiles column).
//   2. PATCH /me/profile round-trips a new prefix value alongside the
//      existing first_name.
//   3. Partial-update semantics: PATCH with no `prefix` key leaves the
//      stored prefix unchanged; an empty string clears it to null.
//   4. first_name is still required (unchanged validation from
//      tb-user-profile-display-name-001).
// Requires the local backend dev server running (npm run dev, from
// application/backend) for these HTTP calls.
// Run via (from application/backend): npx tsx src/scripts/verify-user-profile-email-prefix.ts
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;
const EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL;
const PASSWORD = process.env.MOBILE_TEST_ACCOUNT_PASSWORD;

let failures = 0;

function check(label: string, pass: boolean, detail?: unknown) {
  if (pass) {
    console.log(`PASS: ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${label}`, detail ?? '');
  }
}

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !EMAIL || !PASSWORD) {
    console.error('Missing required env vars -- see the top of this script for the full list.');
    process.exit(1);
  }

  const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signInError || !signIn.session) {
    throw new Error(`Could not sign in as ${EMAIL}: ${signInError?.message}`);
  }
  const headers = { Authorization: `Bearer ${signIn.session.access_token}`, 'Content-Type': 'application/json' };

  // --------------------------------------------------------------------
  // 1. GET returns the real login email
  // --------------------------------------------------------------------
  const getRes = await fetch(`${BACKEND_URL}/me/profile`, { headers });
  const getBody = await getRes.json();
  check('GET /me/profile succeeds', getRes.ok, getBody);
  check('GET /me/profile returns the caller\'s real login email', getBody.email === EMAIL, getBody);

  const originalPrefix = getBody.prefix;
  const originalFirstName = getBody.first_name;

  // --------------------------------------------------------------------
  // 2. PATCH round-trips a new prefix alongside first_name
  // --------------------------------------------------------------------
  const newPrefix = `Verify-${Date.now()}`;
  const patchRes = await fetch(`${BACKEND_URL}/me/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ first_name: originalFirstName ?? 'Verify Account', prefix: newPrefix }),
  });
  const patchBody = await patchRes.json();
  check('PATCH sets prefix and returns it', patchRes.ok && patchBody.prefix === newPrefix, patchBody);
  check('PATCH response still includes email', patchBody.email === EMAIL, patchBody);

  // --------------------------------------------------------------------
  // 3. Omitting `prefix` entirely leaves the stored value unchanged
  // --------------------------------------------------------------------
  const noPrefixKeyRes = await fetch(`${BACKEND_URL}/me/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ first_name: originalFirstName ?? 'Verify Account' }),
  });
  const noPrefixKeyBody = await noPrefixKeyRes.json();
  check(
    'PATCH with no prefix key leaves the stored prefix unchanged',
    noPrefixKeyRes.ok && noPrefixKeyBody.prefix === newPrefix,
    noPrefixKeyBody,
  );

  // --------------------------------------------------------------------
  // 4. An empty string clears prefix to null
  // --------------------------------------------------------------------
  const clearRes = await fetch(`${BACKEND_URL}/me/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ first_name: originalFirstName ?? 'Verify Account', prefix: '' }),
  });
  const clearBody = await clearRes.json();
  check('PATCH with an empty string clears prefix to null', clearRes.ok && clearBody.prefix === null, clearBody);

  // --------------------------------------------------------------------
  // 5. Regression: first_name is still required
  // --------------------------------------------------------------------
  const emptyNameRes = await fetch(`${BACKEND_URL}/me/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ first_name: '', prefix: 'should not matter' }),
  });
  check('PATCH with empty first_name is still rejected (400), regardless of prefix', emptyNameRes.status === 400);

  // --------------------------------------------------------------------
  // Restore original state
  // --------------------------------------------------------------------
  await fetch(`${BACKEND_URL}/me/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ first_name: originalFirstName ?? 'Verify Account', prefix: originalPrefix ?? '' }),
  });

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
