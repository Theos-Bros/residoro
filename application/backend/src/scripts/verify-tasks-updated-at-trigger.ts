import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Verifies the trg_tasks_updated_at fix: creates a task, waits a real
// couple of seconds (a same-transaction backdate attempt would just get
// overridden by the trigger itself, not a valid test), marks it done via
// the same kind of update PATCH /tasks/:id issues, and confirms updated_at
// moved forward by roughly the wait -- not still equal to created_at.
async function main() {
  const { data: tenant } = await supabaseAdmin.from('workspaces').select('id').limit(1).single();

  const { data: task } = await supabaseAdmin
    .from('tasks')
    .insert({ tenant_id: tenant!.id, title: 'Zzqtrigger test task', task_type: 'manual' })
    .select('id, created_at, updated_at')
    .single();
  console.log('Created:', task);

  await new Promise((resolve) => setTimeout(resolve, 2000));

  await supabaseAdmin.from('tasks').update({ status: 'done' }).eq('id', task!.id);

  const after = await supabaseAdmin.from('tasks').select('updated_at, status').eq('id', task!.id).single();
  console.log('After marking done (2s later):', after.data);

  await supabaseAdmin.from('tasks').delete().eq('id', task!.id);

  const bumped = new Date(after.data!.updated_at).getTime() > new Date(task!.created_at).getTime() + 1500;
  if (!bumped) {
    console.error('\nFAIL: updated_at did not bump when status changed.');
    process.exit(1);
  }
  console.log('\nPASS: updated_at bumped to now when status changed to done.');
}

main();
