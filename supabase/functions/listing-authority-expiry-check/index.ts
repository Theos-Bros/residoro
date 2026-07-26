// tb-listings-authority-expiry-notification-001: daily authority-expiry
// warning check.
//
// Triggered by pg_cron (see
// supabase/migrations/20260727110000_listing_authority_expiry_notification.sql)
// via pg_net, once a day -- same architecture as contract-expiry-check and
// training-reminder-check (see contract-expiry-check's header comment for
// the full 5-agent design review reasoning).
//
// Reuses the project-wide CRON_SECRET / RESEND_API_KEY / RESEND_FROM_EMAIL
// secrets already set for contract-expiry-check -- no new secret bootstrap
// needed (confirmed via `supabase secrets list`, 2026-07-27). SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY are auto-injected by the platform into every
// Edge Function.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Residoro <onboarding@resend.dev>';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const WARNING_LEAD_DAYS = 7;

type Listing = {
  id: string;
  agent_id: string;
  authority_expires_at: string | null;
  authority_warning_7d_sent_at: string | null;
  properties: { title: string } | null;
};

// UTC-safe day diff -- same reasoning as contract-expiry-check's daysUntil,
// adapted for a timestamptz input rather than a plain DATE: truncate both
// sides to their UTC calendar date before diffing.
function daysUntil(isoTimestamp: string): number {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const target = new Date(isoTimestamp);
  const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((targetUtc - todayUtc) / 86_400_000);
}

async function getAgentEmail(agentId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(agentId);
  return data.user?.email ?? null;
}

async function sendWarningEmail(to: string, propertyTitle: string, days: number): Promise<void> {
  if (!RESEND_API_KEY) {
    console.error(`RESEND_API_KEY not set -- skipping authority-expiry email for "${propertyTitle}" (${days}d warning)`);
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
      subject: `Authority to Sell/Lease expiring in ${days} day${days === 1 ? '' : 's'}: ${propertyTitle}`,
      html: `<p>Your listing's Authority to Sell/Lease for <strong>${propertyTitle}</strong> expires in ${days} day${days === 1 ? '' : 's'}.</p><p>Renew it in Residoro to keep marketing this listing without interruption.</p>`,
    }),
  });

  if (!response.ok) {
    console.error(`Resend send failed for "${propertyTitle}" (${days}d warning):`, response.status, await response.text());
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

  const { data: listings, error } = await supabaseAdmin
    .from('listings')
    .select('id, agent_id, authority_expires_at, authority_warning_7d_sent_at, properties(title)')
    .in('status', ['active', 'under_offer'])
    .not('authority_expires_at', 'is', null);

  if (error || !listings) {
    return new Response(JSON.stringify({ error: error?.message ?? 'Could not load listings' }), { status: 500 });
  }

  const summary = { processed: 0, warnings_sent: [] as string[], resets: [] as string[] };

  for (const listing of listings as unknown as Listing[]) {
    summary.processed += 1;
    const days = daysUntil(listing.authority_expires_at!);
    const propertyTitle = listing.properties?.title ?? 'your listing';

    if (days > WARNING_LEAD_DAYS && listing.authority_warning_7d_sent_at) {
      // Renewal case: authority_expires_at was pushed back out past the
      // warning window. Reset so a future approach re-warns, same
      // reset-on-renewal idiom as contract-expiry-check.
      await supabaseAdmin
        .from('listings')
        .update({ authority_warning_7d_sent_at: null })
        .eq('id', listing.id);
      summary.resets.push(listing.id);
      continue;
    }

    if (days > 0 && days <= WARNING_LEAD_DAYS && !listing.authority_warning_7d_sent_at) {
      const agentEmail = await getAgentEmail(listing.agent_id);
      if (agentEmail) await sendWarningEmail(agentEmail, propertyTitle, days);

      await supabaseAdmin
        .from('listings')
        .update({ authority_warning_7d_sent_at: new Date().toISOString() })
        .eq('id', listing.id);

      summary.warnings_sent.push(listing.id);
    }
  }

  return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
