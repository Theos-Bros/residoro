import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Live verification for 20260811100000/20260811100001_generate_unique_handle_grant_lockdown*.sql
// (Supabase security advisor, 2026-08-11: generate_unique_handle(text) had never had an explicit
// grant/revoke, so it sat on Postgres's implicit default PUBLIC EXECUTE plus Supabase's own
// default-privileges grant to anon/authenticated, callable directly and unauthenticated via
// /rest/v1/rpc/generate_unique_handle -- a weak email/handle enumeration primitive). Confirms:
// (a) a direct anon RPC call is now rejected, and (b) the real invite -> handle_new_user()
// trigger path (the only legitimate caller) still assigns a handle correctly. Deletes the
// disposable account it creates afterward.
// Run via: npx tsx src/scripts/verify-generate-unique-handle-grant-lockdown.ts
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL;

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !FRONTEND_URL) {
    console.error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and FRONTEND_URL in .env first.');
    process.exit(1);
  }

  let passed = 0;
  const total = 2;

  // 1. Direct anon RPC call is rejected.
  const rpcResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/generate_unique_handle`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_email: 'security-verify-probe@example.com' }),
  });
  if (rpcResponse.status === 401 || rpcResponse.status === 403) {
    console.log(`PASS: anon RPC call rejected (HTTP ${rpcResponse.status})`);
    passed++;
  } else {
    console.error(`FAIL: anon RPC call returned HTTP ${rpcResponse.status}, expected 401/403`);
  }

  // 2. The real invite path (the only legitimate caller of this function) still works.
  const suffix = Date.now();
  const email = `danielbacud+handle-grant-verify-${suffix}@gmail.com`;
  let userId: string | undefined;

  try {
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${FRONTEND_URL}/accept-invite`,
    });
    if (error || !data.user) {
      console.error('FAIL: invite failed:', error?.message ?? 'unknown error');
    } else {
      userId = data.user.id;
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('handle')
        .eq('id', userId)
        .single();
      if (profileError || !profile?.handle) {
        console.error('FAIL: no handle assigned:', profileError?.message ?? 'handle is null');
      } else {
        console.log(`PASS: handle assigned via legitimate invite path ("${profile.handle}")`);
        passed++;
      }
    }
  } finally {
    if (userId) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      console.log('Cleanup: disposable account deleted.');
    }
  }

  console.log(`\n${passed}/${total} checks passed.`);
  process.exit(passed === total ? 0 : 1);
}

main();
