import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { createStageChangeTask } from '../lib/stageTaskGeneration.js';

const OUTCOMES = ['scheduled', 'completed', 'no_show', 'cancelled'] as const;

// tb-transactions-viewings-001: forward-only stage advance, mirroring the
// "never regress a Lead already at negotiating or later" rule cap-transactions-001
// named. Uses the same ordering as buyerRequirements.ts's own STAGES array --
// a Lead at any index before 'viewing' gets nudged forward; 'lost' (which sorts
// after 'viewing') is correctly left untouched, matching how a stage change
// never un-loses a lead anywhere else in this codebase.
const STAGE_ORDER = [
  'registered',
  'searching',
  'stalled',
  'options_sent',
  'viewing',
  'negotiating',
  'contract_closing',
  'won',
  'lost',
] as const;
const VIEWING_STAGE_INDEX = STAGE_ORDER.indexOf('viewing');

type CreateViewingBody = {
  buyer_requirement_id?: string;
  listing_id?: string;
  scheduled_at?: string;
};
type UpdateViewingBody = { outcome?: string; feedback?: string; scheduled_at?: string };
type ListViewingsQuery = { outcome?: string; scheduled_before?: string; scheduled_after?: string };

export async function registerViewingsRoutes(app: FastifyInstance) {
  // tb-transactions-viewings-001: schedule a viewing against a Lead + listing.
  // Advances buyer_requirements.stage to 'viewing' only if the Lead's current
  // stage is earlier in STAGE_ORDER -- same non-regression rule as every other
  // stage-advancing route in this codebase.
  app.post<{ Body: CreateViewingBody }>('/viewings', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { buyer_requirement_id, listing_id, scheduled_at } = request.body ?? {};

    if (!buyer_requirement_id || !listing_id || !scheduled_at) {
      return reply.status(400).send({ error: 'buyer_requirement_id, listing_id, and scheduled_at are required' });
    }

    const { data: lead, error: leadError } = await supabase
      .from('buyer_requirements')
      .select('id, stage')
      .eq('id', buyer_requirement_id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle<{ id: string; stage: string }>();

    if (leadError) {
      request.log.error(leadError);
      return reply.status(500).send({ error: 'Could not load the lead' });
    }
    if (!lead) {
      return reply.status(404).send({ error: 'Lead not found in your workspace' });
    }

    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id')
      .eq('id', listing_id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle<{ id: string }>();

    if (listingError) {
      request.log.error(listingError);
      return reply.status(500).send({ error: 'Could not verify the listing' });
    }
    if (!listing) {
      return reply.status(404).send({ error: 'Listing not found in your workspace' });
    }

    const { data: viewing, error: viewingError } = await supabase
      .from('viewings')
      .insert({
        tenant_id: request.user!.tenantId,
        buyer_requirement_id,
        listing_id,
        scheduled_at,
        created_by: request.user!.id,
      })
      .select('*')
      .single();

    if (viewingError || !viewing) {
      request.log.error(viewingError);
      return reply.status(500).send({ error: 'Could not schedule the viewing' });
    }

    const currentIndex = STAGE_ORDER.indexOf(lead.stage as (typeof STAGE_ORDER)[number]);
    if (currentIndex >= 0 && currentIndex < VIEWING_STAGE_INDEX) {
      const { error: updateError } = await supabase
        .from('buyer_requirements')
        .update({ stage: 'viewing' })
        .eq('id', lead.id)
        .eq('tenant_id', request.user!.tenantId);

      if (updateError) {
        request.log.error(updateError, 'Viewing scheduled, but could not advance the lead stage');
      } else {
        try {
          await createStageChangeTask(supabase, request.user!.tenantId, request.user!.id, lead.id, 'viewing');
        } catch (taskError) {
          request.log.error(taskError, 'Could not create stage-change task');
        }
      }
    }

    return reply.status(201).send(viewing);
  });

  // tb-transactions-viewings-001: outcome (+ optional feedback / reschedule)
  // update after the fact. Does not touch buyer_requirements.stage -- only
  // the first viewing scheduled advances the stage; outcome recording is a
  // separate concern.
  app.patch<{ Params: { id: string }; Body: UpdateViewingBody }>(
    '/viewings/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { outcome, feedback, scheduled_at } = request.body ?? {};

      if (outcome !== undefined && !OUTCOMES.includes(outcome as (typeof OUTCOMES)[number])) {
        return reply.status(400).send({ error: `outcome must be one of: ${OUTCOMES.join(', ')}` });
      }

      const updateFields: Record<string, unknown> = {};
      if (outcome !== undefined) updateFields.outcome = outcome;
      if (feedback !== undefined) updateFields.feedback = feedback;
      if (scheduled_at !== undefined) updateFields.scheduled_at = scheduled_at;

      const { data, error } = await supabase
        .from('viewings')
        .update(updateFields)
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('*')
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update the viewing' });
      }
      if (!data) {
        return reply.status(404).send({ error: 'Viewing not found in your workspace' });
      }
      return data;
    },
  );

  // tb-calendar-schedule-001: tenant-wide read, the data source for the
  // Calendar page's Viewing Schedules filter. Joins through to the Lead's
  // contact name and the listing's property title so the calendar never
  // needs a second round-trip per event.
  app.get<{ Querystring: ListViewingsQuery }>('/viewings', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { outcome, scheduled_before, scheduled_after } = request.query;

    if (outcome !== undefined && !OUTCOMES.includes(outcome as (typeof OUTCOMES)[number])) {
      return reply.status(400).send({ error: `outcome must be one of: ${OUTCOMES.join(', ')}` });
    }

    let query = supabase
      .from('viewings')
      .select('*, buyer_requirements(contacts(name)), listings(properties(title))')
      .eq('tenant_id', request.user!.tenantId)
      .order('scheduled_at', { ascending: true });

    if (outcome) query = query.eq('outcome', outcome);
    if (scheduled_before) query = query.lte('scheduled_at', scheduled_before);
    if (scheduled_after) query = query.gte('scheduled_at', scheduled_after);

    const { data, error } = await query;
    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load viewings' });
    }
    return { viewings: data ?? [] };
  });

  app.get<{ Params: { id: string } }>(
    '/buyer-requirements/:id/viewings',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { data, error } = await supabase
        .from('viewings')
        .select('*')
        .eq('buyer_requirement_id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .order('scheduled_at', { ascending: false });

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not load viewings' });
      }
      return { viewings: data ?? [] };
    },
  );

  // Read-only from the listing's own detail view.
  app.get<{ Params: { id: string } }>('/listings/:id/viewings', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('viewings')
      .select('*')
      .eq('listing_id', request.params.id)
      .eq('tenant_id', request.user!.tenantId)
      .order('scheduled_at', { ascending: false });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load viewings' });
    }
    return { viewings: data ?? [] };
  });
}
