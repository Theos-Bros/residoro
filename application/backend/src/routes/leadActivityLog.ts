import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'other'] as const;
type ActivityType = (typeof ACTIVITY_TYPES)[number];

type CreateActivityBody = {
  activity_type?: string;
  notes?: string;
  occurred_at?: string;
};

async function loadLead(supabase: ReturnType<typeof getScopedClient>, tenantId: string, leadId: string) {
  const { data, error } = await supabase
    .from('buyer_requirements')
    .select('id')
    .eq('id', leadId)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ id: string }>();
  if (error) throw error;
  return data;
}

// tb-buyer-leads-activity-log-001: a general-purpose, manually-logged running
// history for a Lead (call/email/meeting/note) -- append-only, mirrors
// matchLogs.ts's auth/scoping/existence-check pattern. "Last contact" is
// derived client-side from the most recent entry's occurred_at, no separate
// column or endpoint for it.
export async function registerLeadActivityLogRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: CreateActivityBody }>(
    '/buyer-requirements/:id/activity-log',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const tenantId = request.user!.tenantId;

      const lead = await loadLead(supabase, tenantId, request.params.id).catch((err) => {
        request.log.error(err);
        return undefined;
      });
      if (lead === undefined) return reply.status(500).send({ error: 'Could not load the lead' });
      if (!lead) return reply.status(404).send({ error: 'Lead not found in your workspace' });

      const activityType = request.body?.activity_type;
      if (!activityType || !ACTIVITY_TYPES.includes(activityType as ActivityType)) {
        return reply.status(400).send({ error: `activity_type must be one of: ${ACTIVITY_TYPES.join(', ')}` });
      }

      const { data: inserted, error: insertError } = await supabase
        .from('buyer_requirement_activity_log')
        .insert({
          tenant_id: tenantId,
          buyer_requirement_id: lead.id,
          activity_type: activityType,
          notes: request.body?.notes ?? null,
          occurred_at: request.body?.occurred_at ?? new Date().toISOString(),
          logged_by: request.user!.id,
        })
        .select('id, activity_type, notes, occurred_at, logged_by, created_at')
        .single();
      if (insertError) {
        request.log.error(insertError);
        return reply.status(500).send({ error: 'Could not log activity' });
      }

      return reply.status(201).send({ activity: inserted });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/buyer-requirements/:id/activity-log',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const tenantId = request.user!.tenantId;

      const lead = await loadLead(supabase, tenantId, request.params.id).catch((err) => {
        request.log.error(err);
        return undefined;
      });
      if (lead === undefined) return reply.status(500).send({ error: 'Could not load the lead' });
      if (!lead) return reply.status(404).send({ error: 'Lead not found in your workspace' });

      const { data: entries, error: entriesError } = await supabase
        .from('buyer_requirement_activity_log')
        .select('id, activity_type, notes, occurred_at, logged_by, created_at')
        .eq('buyer_requirement_id', lead.id)
        .eq('tenant_id', tenantId)
        .order('occurred_at', { ascending: false });
      if (entriesError) {
        request.log.error(entriesError);
        return reply.status(500).send({ error: 'Could not load activity log' });
      }

      const loggedByIds = [...new Set((entries ?? []).map((e) => e.logged_by).filter((v): v is string => !!v))];
      const { data: profileRows } =
        loggedByIds.length > 0
          ? await supabaseAdmin.from('profiles').select('id, handle').in('id', loggedByIds)
          : { data: [] as Array<{ id: string; handle: string }> };
      const handleById = new Map((profileRows ?? []).map((r) => [r.id, r.handle]));

      const activity_log = (entries ?? []).map((e) => ({
        ...e,
        logged_by_handle: e.logged_by ? (handleById.get(e.logged_by) ?? null) : null,
      }));

      return { activity_log };
    },
  );
}
