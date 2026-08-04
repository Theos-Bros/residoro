import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { createStageChangeTask } from '../lib/stageTaskGeneration.js';
import { STATUS_TRANSITIONS as LISTING_STATUS_TRANSITIONS } from './listings.js';

const OFFERED_BY = ['buyer', 'seller'] as const;
const RESOLUTION_STATUSES = ['accepted', 'rejected', 'withdrawn'] as const;

// tb-transactions-offers-001: same STAGE_ORDER/forward-only pattern
// viewings.ts established for the 'viewing' advance -- local copy, not a
// shared util, for the same reason viewings.ts gave (buyerRequirements.ts's
// own STAGES array isn't exported).
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
const NEGOTIATING_STAGE_INDEX = STAGE_ORDER.indexOf('negotiating');

type CreateOfferBody = {
  buyer_requirement_id?: string;
  listing_id?: string;
  offered_by?: string;
  amount?: number;
  currency?: string;
  terms?: string;
  supersedes_offer_id?: string;
};
type ResolveOfferBody = { status?: string };

export async function registerOffersRoutes(app: FastifyInstance) {
  // tb-transactions-offers-001: record an initial offer, or a counter when
  // supersedes_offer_id is given. Countering marks the prior offer
  // 'countered' (closed out by this response) and inserts the new row as
  // 'pending' (awaiting a response) -- the doc's own sketch put 'countered'
  // on the new row instead, but that left no state meaning "awaiting
  // response" for a counter; this reading keeps 'pending' consistently
  // meaning that for every row, superseded or not.
  app.post<{ Body: CreateOfferBody }>('/offers', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { buyer_requirement_id, listing_id, offered_by, amount, currency, terms, supersedes_offer_id } =
      request.body ?? {};

    if (!buyer_requirement_id || !listing_id || !offered_by || amount === undefined) {
      return reply
        .status(400)
        .send({ error: 'buyer_requirement_id, listing_id, offered_by, and amount are required' });
    }
    if (!OFFERED_BY.includes(offered_by as (typeof OFFERED_BY)[number])) {
      return reply.status(400).send({ error: "offered_by must be 'buyer' or 'seller'" });
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return reply.status(400).send({ error: 'amount must be a positive number' });
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

    if (supersedes_offer_id) {
      const { data: prior, error: priorError } = await supabase
        .from('offers')
        .select('id, buyer_requirement_id, listing_id, status')
        .eq('id', supersedes_offer_id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<{ id: string; buyer_requirement_id: string; listing_id: string; status: string }>();

      if (priorError) {
        request.log.error(priorError);
        return reply.status(500).send({ error: 'Could not load the offer being countered' });
      }
      if (!prior || prior.buyer_requirement_id !== buyer_requirement_id || prior.listing_id !== listing_id) {
        return reply.status(404).send({ error: 'Offer being countered not found on this lead/listing' });
      }
      if (prior.status !== 'pending') {
        return reply.status(400).send({ error: 'Only a pending offer can be countered' });
      }

      const { error: closeError } = await supabase
        .from('offers')
        .update({ status: 'countered' })
        .eq('id', prior.id)
        .eq('tenant_id', request.user!.tenantId);

      if (closeError) {
        request.log.error(closeError);
        return reply.status(500).send({ error: 'Could not close out the offer being countered' });
      }
    }

    const { data: offer, error: offerError } = await supabase
      .from('offers')
      .insert({
        tenant_id: request.user!.tenantId,
        buyer_requirement_id,
        listing_id,
        offered_by,
        amount,
        currency: currency ?? 'PHP',
        terms: terms ?? null,
        supersedes_offer_id: supersedes_offer_id ?? null,
        created_by: request.user!.id,
      })
      .select('*')
      .single();

    if (offerError || !offer) {
      request.log.error(offerError);
      return reply.status(500).send({ error: 'Could not record the offer' });
    }

    return reply.status(201).send(offer);
  });

  // tb-transactions-offers-001: accept/reject/withdraw a pending offer.
  // Acceptance auto-closes sibling pending offers in the same chain, flips
  // listings.status to 'under_offer' (reusing listings.ts's own transition
  // table -- confirmed with the user this should be automatic, not manual,
  // since the transition exists specifically for this purpose), and advances
  // buyer_requirements.stage to 'negotiating' (forward-only, same
  // non-regression rule as tb-transactions-viewings-001's 'viewing' advance).
  app.patch<{ Params: { id: string }; Body: ResolveOfferBody }>(
    '/offers/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { status } = request.body ?? {};

      if (!status || !RESOLUTION_STATUSES.includes(status as (typeof RESOLUTION_STATUSES)[number])) {
        return reply.status(400).send({ error: `status must be one of: ${RESOLUTION_STATUSES.join(', ')}` });
      }

      const { data: current, error: currentError } = await supabase
        .from('offers')
        .select('id, buyer_requirement_id, listing_id, status')
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<{ id: string; buyer_requirement_id: string; listing_id: string; status: string }>();

      if (currentError) {
        request.log.error(currentError);
        return reply.status(500).send({ error: 'Could not load the offer' });
      }
      if (!current) {
        return reply.status(404).send({ error: 'Offer not found in your workspace' });
      }
      if (current.status !== 'pending') {
        return reply.status(400).send({ error: `Cannot move an offer from '${current.status}' to '${status}'` });
      }

      const { data: offer, error: updateError } = await supabase
        .from('offers')
        .update({ status })
        .eq('id', current.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('*')
        .single();

      if (updateError || !offer) {
        request.log.error(updateError);
        return reply.status(500).send({ error: 'Could not update the offer' });
      }

      if (status !== 'accepted') {
        return offer;
      }

      const { error: closeSiblingsError } = await supabase
        .from('offers')
        .update({ status: 'rejected' })
        .eq('buyer_requirement_id', current.buyer_requirement_id)
        .eq('listing_id', current.listing_id)
        .eq('tenant_id', request.user!.tenantId)
        .eq('status', 'pending')
        .neq('id', current.id);

      if (closeSiblingsError) {
        request.log.error(closeSiblingsError, 'Offer accepted, but could not auto-close sibling offers');
      }

      const { data: listing, error: listingError } = await supabase
        .from('listings')
        .select('id, status')
        .eq('id', current.listing_id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<{ id: string; status: string }>();

      if (listingError) {
        request.log.error(listingError, 'Offer accepted, but could not load the listing to flip its status');
      } else if (listing) {
        const legalNext = LISTING_STATUS_TRANSITIONS[listing.status] ?? [];
        if (legalNext.includes('under_offer')) {
          const { error: listingUpdateError } = await supabase
            .from('listings')
            .update({ status: 'under_offer' })
            .eq('id', listing.id)
            .eq('tenant_id', request.user!.tenantId);

          if (listingUpdateError) {
            request.log.error(listingUpdateError, 'Offer accepted, but could not flip listing status');
          }
        }
      }

      const { data: lead, error: leadError } = await supabase
        .from('buyer_requirements')
        .select('id, stage')
        .eq('id', current.buyer_requirement_id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<{ id: string; stage: string }>();

      if (leadError) {
        request.log.error(leadError, 'Offer accepted, but could not load the lead to advance its stage');
      } else if (lead) {
        const currentIndex = STAGE_ORDER.indexOf(lead.stage as (typeof STAGE_ORDER)[number]);
        if (currentIndex >= 0 && currentIndex < NEGOTIATING_STAGE_INDEX) {
          const { error: stageUpdateError } = await supabase
            .from('buyer_requirements')
            .update({ stage: 'negotiating' })
            .eq('id', lead.id)
            .eq('tenant_id', request.user!.tenantId);

          if (stageUpdateError) {
            request.log.error(stageUpdateError, 'Offer accepted, but could not advance the lead stage');
          } else {
            try {
              await createStageChangeTask(supabase, request.user!.tenantId, request.user!.id, lead.id, 'negotiating');
            } catch (taskError) {
              request.log.error(taskError, 'Could not create stage-change task');
            }
          }
        }
      }

      return offer;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/buyer-requirements/:id/offers',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { data, error } = await supabase
        .from('offers')
        .select('*')
        .eq('buyer_requirement_id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .order('created_at', { ascending: false });

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not load offers' });
      }
      return { offers: data ?? [] };
    },
  );

  // Read-only from the listing's own detail view.
  app.get<{ Params: { id: string } }>('/listings/:id/offers', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('offers')
      .select('*')
      .eq('listing_id', request.params.id)
      .eq('tenant_id', request.user!.tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load offers' });
    }
    return { offers: data ?? [] };
  });
}
