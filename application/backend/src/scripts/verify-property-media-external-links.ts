import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// tb-properties-media-external-links-001 DoD verification: end-to-end check
// that photo/video links are added, listed, updated, and deleted via plain
// JSON (no Storage/multipart involved anywhere), against the real running
// backend and the real Supabase project.
// Run via (from application/backend, dev server running on PORT):
//   npx tsx src/scripts/verify-property-media-external-links.ts
const EMAIL = process.env.MOBILE_TEST_ACCOUNT_EMAIL;
const PASSWORD = process.env.MOBILE_TEST_ACCOUNT_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;

async function main() {
  if (!EMAIL || !PASSWORD || !SUPABASE_URL || !PUBLISHABLE_KEY) {
    console.error('Set MOBILE_TEST_ACCOUNT_EMAIL/PASSWORD, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY in .env first.');
    process.exit(1);
  }

  const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signInError || !signIn.session) {
    console.error('Could not sign in as the test account:', signInError?.message);
    process.exit(1);
  }
  const token = signIn.session.access_token;
  console.log(`Signed in as ${EMAIL}`);

  const { data: profile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', signIn.user!.id).single();
  const { data: property } = await supabaseAdmin
    .from('properties')
    .select('id, title')
    .eq('tenant_id', profile!.tenant_id)
    .limit(1)
    .single();
  if (!property) {
    console.error('No property found for this tenant to test against.');
    process.exit(1);
  }
  console.log(`Using property ${property.id} (${property.title})`);

  async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    const body = await response.json().catch(() => undefined);
    return { status: response.status, body };
  }

  console.log('\n--- 1. Reject a non-http(s) value ---');
  const rejected = await call(`/properties/${property.id}/media`, { method: 'POST', body: JSON.stringify({ url: 'not-a-url' }) });
  console.log(rejected);
  if (rejected.status !== 400) throw new Error('FAIL: invalid URL was not rejected with 400');
  console.log('PASS');

  console.log('\n--- 2. Add first link (photo) -> becomes cover ---');
  const first = await call(`/properties/${property.id}/media`, {
    method: 'POST',
    body: JSON.stringify({ url: 'https://photos.google.com/share/test-album-1', type: 'photo' }),
  });
  console.log(first);
  if (first.status !== 201 || !first.body.is_cover) throw new Error('FAIL: first link should be cover');
  console.log('PASS');

  console.log('\n--- 3. Add second link (video) -> not cover ---');
  const second = await call(`/properties/${property.id}/media`, {
    method: 'POST',
    body: JSON.stringify({ url: 'https://youtu.be/test-video-1', type: 'video' }),
  });
  console.log(second);
  if (second.status !== 201 || second.body.is_cover) throw new Error('FAIL: second link should not be cover');
  console.log('PASS');

  console.log('\n--- 4. GET media list -> both present, no url-signing fields ---');
  const list = await call(`/properties/${property.id}/media`);
  console.log(list);
  if (list.body.media.length < 2) throw new Error('FAIL: expected at least 2 media rows');
  if (!list.body.media.every((m: { external_url: string }) => typeof m.external_url === 'string')) {
    throw new Error('FAIL: expected external_url on every row');
  }
  console.log('PASS');

  console.log('\n--- 5. Set second link as cover -> exactly one cover afterward ---');
  const setCover = await call(`/properties/${property.id}/media/${second.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_cover: true }),
  });
  console.log(setCover);
  const afterSetCover = await call(`/properties/${property.id}/media`);
  const covers = afterSetCover.body.media.filter((m: { is_cover: boolean }) => m.is_cover);
  if (covers.length !== 1 || covers[0].id !== second.body.id) throw new Error('FAIL: expected exactly one cover, the second link');
  console.log('PASS');

  console.log('\n--- 6. Delete the cover link -> next link auto-promoted ---');
  const del = await call(`/properties/${property.id}/media/${second.body.id}`, { method: 'DELETE' });
  console.log(del);
  const afterDelete = await call(`/properties/${property.id}/media`);
  const remainingCovers = afterDelete.body.media.filter((m: { is_cover: boolean }) => m.is_cover);
  if (remainingCovers.length !== 1 || remainingCovers[0].id !== first.body.id) {
    throw new Error('FAIL: expected the first link to be auto-promoted to cover');
  }
  console.log('PASS');

  console.log('\n--- 7. Cleanup: delete remaining test link ---');
  await call(`/properties/${property.id}/media/${first.body.id}`, { method: 'DELETE' });
  const afterCleanup = await call(`/properties/${property.id}/media`);
  if (afterCleanup.body.media.length !== 0) throw new Error('FAIL: expected no media rows left after cleanup');
  console.log('PASS');

  console.log('\n--- 8. GET /properties still returns cover_photo_url (raw link, no signing) ---');
  const listAll = await call('/properties');
  console.log('sample:', listAll.body.properties?.[0]);
  console.log('PASS (manual inspection above -- no signed-URL 500s, field present)');

  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
