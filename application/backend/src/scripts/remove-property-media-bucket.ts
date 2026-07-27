// One-off cleanup for tb-properties-media-external-links-001: the
// property-media Storage bucket can't be dropped via a SQL migration
// (Supabase blocks direct DML on storage.objects/storage.buckets outside the
// Storage API), so this empties and removes it via the JS client instead.
// Safe to delete after the migration ships; not part of the app runtime.
import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const BUCKET = 'property-media';

async function main() {
  const { data: files, error: listError } = await supabaseAdmin.storage.from(BUCKET).list(undefined, { limit: 1000 });
  if (listError) throw listError;
  console.log(`Found ${files?.length ?? 0} top-level entries in ${BUCKET}`);

  // Bucket is organized {tenant_id}/{property_id}/{uuid}.{ext} -- walk one
  // level of folders and remove everything found, since there's no real
  // client data to worry about losing.
  async function removeAll(prefix: string) {
    const { data: entries, error } = await supabaseAdmin.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (error) throw error;
    for (const entry of entries ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        await removeAll(path); // folder
      } else {
        await supabaseAdmin.storage.from(BUCKET).remove([path]);
        console.log(`Removed ${path}`);
      }
    }
  }
  await removeAll('');

  const { error: deleteBucketError } = await supabaseAdmin.storage.deleteBucket(BUCKET);
  if (deleteBucketError) throw deleteBucketError;
  console.log(`Deleted bucket ${BUCKET}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
