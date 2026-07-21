// tb-client-lifecycle-contract-expiry-001: daily contract-expiry check.
//
// Triggered by pg_cron (see supabase/migrations/20260722120000_contract_expiry.sql)
// via pg_net, once a day. Owns all the state-transition/warning/email logic
// in TypeScript rather than plpgsql -- see that migration's header comment
// for why (5-agent design review, 2026-07-22).
//
// Requires two function secrets (set via `supabase secrets set`, never
// committed): CRON_SECRET (must match the value stored in Supabase Vault as
// 'contract_expiry_cron_secret', see the migration) and RESEND_API_KEY.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the
// platform into every Edge Function -- no need to set those.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Residoro <onboarding@resend.dev>';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type AccessState = 'active' | 'read_only' | 'blocked';
type Threshold = '30d' | '7d' | '1d';

type Workspace = {
  id: string;
  name: string;
  contract_end_date: string;
  access_state: AccessState;
  warning_30d_sent_at: string | null;
  warning_7d_sent_at: string | null;
  warning_1d_sent_at: string | null;
};

const THRESHOLDS: [number, Threshold, 'warning_30d_sent_at' | 'warning_7d_sent_at' | 'warning_1d_sent_at'][] = [
  [30, '30d', 'warning_30d_sent_at'],
  [7, '7d', 'warning_7d_sent_at'],
  [1, '1d', 'warning_1d_sent_at'],
];

// UTC-safe day diff -- avoids off-by-one from local-timezone midnight
// boundaries, since contract_end_date is a plain DATE with no timezone.
function daysUntil(dateStr: string): number {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetUtc = Date.UTC(y, m - 1, d);
  return Math.round((targetUtc - todayUtc) / 86_400_000);
}

function warningMessage(workspaceName: string, days: number): string {
  const noun = days === 1 ? 'day' : 'days';
  return `${workspaceName}'s contract expires in ${days} ${noun}. Renew to avoid a read-only grace period and eventual access block.`;
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

async function sendWarningEmail(to: string, workspaceName: string, days: number): Promise<void> {
  if (!RESEND_API_KEY) {
    console.error(`RESEND_API_KEY not set -- skipping email for "${workspaceName}" (${days}d warning)`);
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
      subject: `Action needed: ${workspaceName}'s Residoro contract expires in ${days} day${days === 1 ? '' : 's'}`,
      html: `<p>${warningMessage(workspaceName, days)}</p><p>Contact your Residoro representative to renew.</p>`,
    }),
  });

  if (!response.ok) {
    console.error(`Resend send failed for "${workspaceName}" (${days}d warning):`, response.status, await response.text());
  }
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('authorization');
  const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

  // Fails closed: if CRON_SECRET was never set, provided !== undefined can
  // never match, so every request is rejected rather than silently trusted.
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { data: workspaces, error } = await supabaseAdmin
    .from('workspaces')
    .select('id, name, contract_end_date, access_state, warning_30d_sent_at, warning_7d_sent_at, warning_1d_sent_at');

  if (error || !workspaces) {
    return new Response(JSON.stringify({ error: error?.message ?? 'Could not load workspaces' }), { status: 500 });
  }

  const summary = { processed: 0, warnings_sent: [] as string[], state_changes: [] as string[] };

  for (const ws of workspaces as Workspace[]) {
    summary.processed += 1;
    const days = daysUntil(ws.contract_end_date);
    const update: Partial<Workspace> = {};

    for (const [thresholdDays, threshold, column] of THRESHOLDS) {
      if (days === thresholdDays && !ws[column]) {
        const adminEmail = await getAdminEmail(ws.id);
        if (adminEmail) await sendWarningEmail(adminEmail, ws.name, thresholdDays);

        await supabaseAdmin.from('contract_notifications').insert({
          tenant_id: ws.id,
          threshold,
          message: warningMessage(ws.name, thresholdDays),
        });

        update[column] = new Date().toISOString();
        summary.warnings_sent.push(`${ws.id}:${threshold}`);
      }
    }

    let nextState: AccessState = ws.access_state;
    if (days > 30) {
      // Renewal case: contract_end_date was pushed back out. Reset fully so
      // the next countdown starts clean, and clear any now-stale side-panel
      // notifications (doc: "persists until dismissed or the state changes").
      nextState = 'active';
      update.warning_30d_sent_at = null;
      update.warning_7d_sent_at = null;
      update.warning_1d_sent_at = null;
      await supabaseAdmin
        .from('contract_notifications')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('tenant_id', ws.id)
        .is('dismissed_at', null);
    } else if (days <= -7) {
      nextState = 'blocked';
    } else if (days <= 0) {
      nextState = 'read_only';
    }

    if (nextState !== ws.access_state) {
      update.access_state = nextState;
      summary.state_changes.push(`${ws.id}:${ws.access_state}->${nextState}`);
    }

    if (Object.keys(update).length > 0) {
      await supabaseAdmin.from('workspaces').update(update).eq('id', ws.id);
    }
  }

  return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
