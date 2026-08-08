// tb-notifications-task-due-reminder-001: daily task due-date reminder
// check, cap-notifications-001's TB1 and first real consumer of the new
// `notifications` table.
//
// Triggered by pg_cron (see
// supabase/migrations/20260808130000_notifications_task_due_reminder.sql)
// via pg_net, once a day -- same architecture as contract-expiry-check,
// listing-authority-expiry-check, and training-reminder-check (see
// contract-expiry-check's header comment for the full 5-agent design
// review reasoning).
//
// Reuses the project-wide CRON_SECRET / RESEND_API_KEY / RESEND_FROM_EMAIL
// secrets already set for contract-expiry-check -- confirmed project-wide,
// not per-function, by listing-authority-expiry-check's own implementation
// (2026-07-27) -- no new secret bootstrap needed. SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY are auto-injected by the platform into every
// Edge Function.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Residoro <onboarding@resend.dev>';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Single fixed lead-time threshold, matching listing-authority-expiry-
// check's own "smallest real slice" precedent -- confirmed with the user
// (2026-08-08) over a configurable-per-workspace or multi-tier schedule.
const WARNING_LEAD_DAYS = 1;

type Task = {
  id: string;
  tenant_id: string;
  title: string;
  due_date: string; // plain 'YYYY-MM-DD', unlike authority_expires_at's timestamptz
  assignee_id: string;
  reminder_sent_at: string | null;
};

// due_date is a plain DATE ('YYYY-MM-DD'), not a timestamptz -- no UTC
// truncation needed on that side, only on "today" (the Edge Function's own
// clock), same intent as contract-expiry-check's daysUntil but simpler
// since one side is already a bare calendar date.
function daysUntil(dueDateStr: string): number {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [y, m, d] = dueDateStr.split('-').map(Number);
  const targetUtc = Date.UTC(y, m - 1, d);
  return Math.round((targetUtc - todayUtc) / 86_400_000);
}

async function getAssigneeEmail(assigneeId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(assigneeId);
  return data.user?.email ?? null;
}

async function sendReminderEmail(to: string, taskTitle: string, days: number): Promise<void> {
  if (!RESEND_API_KEY) {
    console.error(`RESEND_API_KEY not set -- skipping task-due-reminder email for "${taskTitle}" (${days}d warning)`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject: `Task due in ${days} day${days === 1 ? '' : 's'}: ${taskTitle}`,
      html: `<p>Your task <strong>${taskTitle}</strong> is due in ${days} day${days === 1 ? '' : 's'}.</p><p>Open Residoro's Tasks page to review or reassign it.</p>`,
    }),
  });

  if (!response.ok) {
    console.error(`Resend send failed for "${taskTitle}" (${days}d warning):`, response.status, await response.text());
  }
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('authorization');
  const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

  // Fails closed, same as every other cron-triggered check in this codebase:
  // an unset/mismatched CRON_SECRET rejects every request rather than
  // silently trusting it.
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { data: tasks, error } = await supabaseAdmin
    .from('tasks')
    .select('id, tenant_id, title, due_date, assignee_id, reminder_sent_at')
    .in('status', ['open', 'in_progress'])
    .not('due_date', 'is', null)
    .not('assignee_id', 'is', null);

  if (error || !tasks) {
    return new Response(JSON.stringify({ error: error?.message ?? 'Could not load tasks' }), { status: 500 });
  }

  const summary = { processed: 0, warnings_sent: [] as string[], resets: [] as string[] };

  for (const task of tasks as unknown as Task[]) {
    summary.processed += 1;
    const days = daysUntil(task.due_date);

    if (days > WARNING_LEAD_DAYS && task.reminder_sent_at) {
      // Reschedule case: due_date was pushed back out past the warning
      // window. Reset so a future approach re-warns, same reset-on-renewal
      // idiom as contract-expiry-check / listing-authority-expiry-check.
      await supabaseAdmin
        .from('tasks')
        .update({ reminder_sent_at: null })
        .eq('id', task.id);
      summary.resets.push(task.id);
      continue;
    }

    if (days > 0 && days <= WARNING_LEAD_DAYS && !task.reminder_sent_at) {
      const assigneeEmail = await getAssigneeEmail(task.assignee_id);
      if (assigneeEmail) await sendReminderEmail(assigneeEmail, task.title, days);

      const { error: insertError } = await supabaseAdmin.from('notifications').insert({
        tenant_id: task.tenant_id,
        recipient_id: task.assignee_id,
        type: 'task_due',
        entity_type: 'task',
        entity_id: task.id,
        title: 'Task due soon',
        message: `"${task.title}" is due in ${days} day${days === 1 ? '' : 's'}.`,
      });
      if (insertError) console.error(`Could not insert notification for task ${task.id}:`, insertError.message);

      await supabaseAdmin
        .from('tasks')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', task.id);

      summary.warnings_sent.push(task.id);
    }
  }

  return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
