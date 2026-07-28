import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveRoutedAssignee } from '../routes/tasks.js';

// tb-buyer-leads-stage-tasks-001: fixed per-stage title/task_type mapping.
// Implementation-time defaults, not confirmed copy with the user -- editable
// per-task after creation via the existing PATCH /tasks/:id, same as any
// other task's title.
const STAGE_TASK_TITLES: Record<string, string> = {
  registered: 'Follow up with new lead',
  searching: 'Review search results',
  stalled: 'Re-engage stalled lead',
  options_sent: 'Follow up on sent options',
  viewing: 'Confirm viewing',
  negotiating: 'Follow up post-negotiation',
  contract_closing: 'Prepare contract paperwork',
  won: 'Confirm sale closed',
  lost: 'Log lost reason',
};

// Called after any of the 4 real stage-change code paths (PATCH
// /buyer-requirements/:id, the searching auto-advance in matching.ts, the
// options-sent auto-advance, mark-won's auto-advance) successfully changes
// `stage` on an existing row. Never called from POST /buyer-requirements
// (creation) -- an initial `stage` value isn't a change.
//
// Inserts directly into `tasks` (same shape as tasks.ts's own POST /tasks
// handler, including its routing lookup) rather than making an internal HTTP
// call, matching how every other cross-route internal write in this
// codebase already works.
export async function createStageChangeTask(
  supabase: SupabaseClient,
  tenantId: string,
  createdBy: string,
  buyerRequirementId: string,
  newStage: string,
): Promise<void> {
  const taskType = `stage_${newStage}`;
  const title = STAGE_TASK_TITLES[newStage] ?? `Follow up: ${newStage}`;

  const assigneeId = await resolveRoutedAssignee(supabase, tenantId, taskType);

  const { error } = await supabase.from('tasks').insert({
    tenant_id: tenantId,
    created_by: createdBy,
    title,
    task_type: taskType,
    entity_type: 'buyer_requirement',
    entity_id: buyerRequirementId,
    assignee_id: assigneeId,
  });

  if (error) throw error;
}
