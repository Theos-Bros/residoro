// tb-client-lifecycle-training-001: daily training-session reminder check.
//
// Triggered by pg_cron (see supabase/migrations/20260722150000_training_sessions.sql)
// via pg_net, once a day -- same architecture as contract-expiry-check
// (see that function's header comment). Fires a single reminder email
// exactly 3 days before a session's scheduled_date, confirmed with the user
// 2026-07-22 (a single-tier reminder, not contract-expiry's 30/7/1 schedule).
//
// Reuses the project-wide CRON_SECRET / RESEND_API_KEY / RESEND_FROM_EMAIL
// secrets already set for contract-expiry-check -- no new secret bootstrap
// needed. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the
// platform into every Edge Function.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Residoro <onboarding@resend.dev>';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const REMINDER_LEAD_DAYS = 3;

type TrainingSession = {
  id: string;
  workspace_id: string;
  session_number: number;
  scheduled_date: string;
  reminder_sent_at: string | null;
  workspaces: { name: string } | null;
};

// UTC-safe day diff -- same reasoning as contract-expiry-check's daysUntil:
// scheduled_date is a plain DATE with no timezone, so comparing via local
// midnight would risk an off-by-one near a timezone boundary.
function daysUntil(dateStr: string): number {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetUtc = Date.UTC(y, m - 1, d);
  return Math.round((targetUtc - todayUtc) / 86_400_000);
}

async function getAdminEmail(tenantId: string): Promise<string | null> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('role', 'admin')
    .single();
  if (!profile) return null;

  const { data } = await supabaseAdmin.auth.admin.getUserById(profile.id);
  return data.user?.email ?? null;
}

async function sendReminderEmail(to: string, workspaceName: string, sessionNumber: number, date: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.error(`RESEND_API_KEY not set -- skipping reminder for "${workspaceName}" session ${sessionNumber}`);
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
      subject: `Reminder: ${workspaceName}'s training session ${sessionNumber} is in ${REMINDER_LEAD_DAYS} days`,
      html: `<p>${workspaceName}'s training session ${sessionNumber} is scheduled for ${date}, ${REMINDER_LEAD_DAYS} days from now.</p>`,
    }),
  });

  if (!response.ok) {
    console.error(
      `Resend send failed for "${workspaceName}" session ${sessionNumber}:`,
      response.status,
      await response.text(),
    );
  }
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('authorization');
  const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

  // Fails closed, same as contract-expiry-check: an unset/mismatched
  // CRON_SECRET rejects every request rather than silently trusting it.
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { data: sessions, error } = await supabaseAdmin
    .from('training_sessions')
    .select('id, workspace_id, session_number, scheduled_date, reminder_sent_at, workspaces(name)')
    .eq('status', 'scheduled')
    .is('reminder_sent_at', null);

  if (error || !sessions) {
    return new Response(JSON.stringify({ error: error?.message ?? 'Could not load training sessions' }), { status: 500 });
  }

  const summary = { processed: 0, reminders_sent: [] as string[] };

  for (const s of sessions as unknown as TrainingSession[]) {
    summary.processed += 1;
    if (daysUntil(s.scheduled_date) !== REMINDER_LEAD_DAYS) continue;

    const workspaceName = s.workspaces?.name ?? 'A client';
    const adminEmail = await getAdminEmail(s.workspace_id);
    if (adminEmail) await sendReminderEmail(adminEmail, workspaceName, s.session_number, s.scheduled_date);

    await supabaseAdmin
      .from('training_sessions')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', s.id);

    summary.reminders_sent.push(`${s.workspace_id}:session_${s.session_number}`);
  }

  return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
