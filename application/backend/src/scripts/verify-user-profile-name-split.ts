import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-user-profile-name-split-001 DoD verification:
//   1. GET/PATCH /me/profile work with first_name/last_name (first_name
//      required, last_name optional, partial-update semantics preserved).
//   2. A brand-new signup's raw_user_meta_data.full_name is correctly split
//      into first_name/last_name by the redefined handle_new_user() trigger.
//   3. Regression: GET /workspace/members, GET /tasks/assignees, and
//      GET /settings/permissions all still return a `full_name` field
//      (now server-computed from first_name/last_name).
// Requires the local backend dev server running (npm run dev, from
// application/backend) for these HTTP calls.
// Run via (from application/backend): npx tsx src/scripts/verify-user-profile-name-split.ts
const SUPABASE_URL = process.env.SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;
const EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL!;
const PASSWORD = process.env.MOBILE_TEST_ACCOUNT_PASSWORD!;

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
  // 1. GET returns first_name/last_name/prefix/email
  // --------------------------------------------------------------------
  const getRes = await fetch(`${BACKEND_URL}/me/profile`, { headers });
  const getBody = await getRes.json();
  check('GET /me/profile succeeds', getRes.ok, getBody);
  check('GET /me/profile has no leftover full_name field', !('full_name' in getBody), getBody);

  const originalFirstName = getBody.first_name;
  const originalLastName = getBody.last_name;
  const originalPrefix = getBody.prefix;

  // --------------------------------------------------------------------
  // 2. PATCH round-trips first_name + last_name
  // --------------------------------------------------------------------
  const patchRes = await fetch(`${BACKEND_URL}/me/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ first_name: 'Verify', last_name: 'Split', prefix: originalPrefix ?? '' }),
  });
  const patchBody = await patchRes.json();
  check(
    'PATCH sets first_name/last_name and returns them',
    patchRes.ok && patchBody.first_name === 'Verify' && patchBody.last_name === 'Split',
    patchBody,
  );

  // --------------------------------------------------------------------
  // 3. last_name is optional -- clearing it to null works
  // --------------------------------------------------------------------
  const clearLastNameRes = await fetch(`${BACKEND_URL}/me/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ first_name: 'Verify', last_name: '' }),
  });
  const clearLastNameBody = await clearLastNameRes.json();
  check(
    'PATCH with empty last_name clears it to null',
    clearLastNameRes.ok && clearLastNameBody.last_name === null,
    clearLastNameBody,
  );

  // --------------------------------------------------------------------
  // 4. Regression: first_name is still required
  // --------------------------------------------------------------------
  const emptyFirstNameRes = await fetch(`${BACKEND_URL}/me/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ first_name: '' }),
  });
  check('PATCH with empty first_name is rejected (400)', emptyFirstNameRes.status === 400);

  // Restore original state
  await fetch(`${BACKEND_URL}/me/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      first_name: originalFirstName ?? 'Verify',
      last_name: originalLastName ?? '',
      prefix: originalPrefix ?? '',
    }),
  });

  // --------------------------------------------------------------------
  // 5. A brand-new signup's full_name metadata is correctly split by the
  //    redefined handle_new_user() trigger.
  // --------------------------------------------------------------------
  const tempEmail = `danielbacud+residoro-namesplit-${Date.now()}@gmail.com`;
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: tempEmail,
    password: `Temp-${Math.random().toString(36).slice(2)}!Aa1`,
    email_confirm: true,
    user_metadata: { full_name: 'Jane Dela Cruz' },
  });
  if (createError || !created.user) throw new Error(`Could not create temp signup: ${createError?.message}`);
  const tempUserId = created.user.id;

  try {
    const { data: tempProfile, error: tempProfileError } = await supabaseAdmin
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', tempUserId)
      .single<{ first_name: string | null; last_name: string | null }>();
    check(
      'new signup: "Jane Dela Cruz" splits into first_name="Jane", last_name="Dela Cruz"',
      !tempProfileError && tempProfile?.first_name === 'Jane' && tempProfile?.last_name === 'Dela Cruz',
      { tempProfileError, tempProfile },
    );
  } finally {
    await supabaseAdmin.from('profiles').delete().eq('id', tempUserId);
    await supabaseAdmin.auth.admin.deleteUser(tempUserId);
  }

  // --------------------------------------------------------------------
  // 6. Regression: display-only consumers still return a full_name field
  // --------------------------------------------------------------------
  const membersRes = await fetch(`${BACKEND_URL}/workspace/members`, { headers });
  const membersBody = await membersRes.json();
  check(
    'GET /workspace/members still returns full_name per member (regression)',
    membersRes.ok && Array.isArray(membersBody.members) && membersBody.members.every((m: any) => 'full_name' in m),
    membersBody,
  );

  const assigneesRes = await fetch(`${BACKEND_URL}/tasks/assignees`, { headers });
  const assigneesBody = await assigneesRes.json();
  check(
    'GET /tasks/assignees still returns full_name per member (regression)',
    assigneesRes.ok && Array.isArray(assigneesBody.members) && assigneesBody.members.every((m: any) => 'full_name' in m),
    assigneesBody,
  );

  const permissionsRes = await fetch(`${BACKEND_URL}/settings/permissions`, { headers });
  const permissionsBody = await permissionsRes.json();
  check(
    'GET /settings/permissions still returns full_name per member (regression)',
    permissionsRes.ok &&
      Array.isArray(permissionsBody.members) &&
      permissionsBody.members.every((m: any) => 'full_name' in m),
    permissionsBody,
  );

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
