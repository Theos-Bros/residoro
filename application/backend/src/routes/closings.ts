import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { createStageChangeTask } from '../lib/stageTaskGeneration.js';
import { STATUS_TRANSITIONS as LISTING_STATUS_TRANSITIONS } from './listings.js';

// tb-transactions-closing-001: same STAGE_ORDER/forward-only pattern
// offers.ts/contracts.ts established -- local copy, not a shared util, for
// the same reason those gave (buyerRequirements.ts's own STAGES array isn't
// exported).
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
const WON_STAGE_INDEX = STAGE_ORDER.indexOf('won');

type CreateClosingBody = {
  contract_id?: string;
};
type UpdateClosingBody = {
  final_price?: number;
  currency?: string;
  checklist_state?: Record<string, unknown>;
  completed?: boolean;
  lease_end_date?: string;
};

export async function registerClosingsRoutes(app: FastifyInstance) {
  // tb-transactions-closing-001: open a closing against a signed contract.
  // buyer_requirement_id/listing_id are derived from the contract itself
  // (not trusted client input), same reasoning tb-transactions-contract-001
  // gave for deriving its own fields from the offer.
  app.post<{ Body: CreateClosingBody }>('/closings', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { contract_id } = request.body ?? {};

    if (!contract_id) {
      return reply.status(400).send({ error: 'contract_id is required' });
    }

    const { data: contract, error: contractError } = await supabase
      .from('contracts')
      .select('id, buyer_requirement_id, listing_id, signing_status, agreed_price, currency')
      .eq('id', contract_id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle<{
        id: string;
        buyer_requirement_id: string;
        listing_id: string;
        signing_status: string;
        agreed_price: number;
        currency: string;
      }>();

    if (contractError) {
      request.log.error(contractError);
      return reply.status(500).send({ error: 'Could not load the contract' });
    }
    if (!contract) {
      return reply.status(404).send({ error: 'Contract not found in your workspace' });
    }
    if (contract.signing_status !== 'signed') {
      return reply.status(400).send({ error: 'A closing can only be opened against a signed contract' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('closings')
      .select('id')
      .eq('contract_id', contract.id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle<{ id: string }>();

    if (existingError) {
      request.log.error(existingError);
      return reply.status(500).send({ error: 'Could not check for an existing closing' });
    }
    if (existing) {
      return reply.status(400).send({ error: 'A closing already exists for this contract' });
    }

    const { data: closing, error: closingError } = await supabase
      .from('closings')
      .insert({
        tenant_id: request.user!.tenantId,
        contract_id: contract.id,
        buyer_requirement_id: contract.buyer_requirement_id,
        listing_id: contract.listing_id,
        final_price: contract.agreed_price,
        currency: contract.currency,
        created_by: request.user!.id,
      })
      .select('*')
      .single();

    if (closingError || !closing) {
      request.log.error(closingError);
      return reply.status(500).send({ error: 'Could not open the closing' });
    }

    return reply.status(201).send(closing);
  });

  // tb-transactions-closing-001: edit final_price/currency/checklist_state
  // pre-completion, or complete the closing (completed: true). Completion:
  // 1) advances buyer_requirements.stage -> 'won' (forward-only) along with
  //    won_listing_id and (for a rental listing) lease_end_date -- parity
  //    with the existing options-sent mark-won flow, confirmed with the
  //    user, since both paths land on the same stage/banner/Revisit-page
  //    fields; 2) flips listings.status -> 'sold' + buyer_contact_id,
  //    reusing tb-crm-buyer-001's existing write path -- confirmed with the
  //    user this should finally be automatic now that a real Closing
  //    feature exists, reversing tb-listings-status-ladder-001's prior
  //    "deliberately decoupled" default.
  app.patch<{ Params: { id: string }; Body: UpdateClosingBody }>(
    '/closings/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { final_price, currency, checklist_state, completed, lease_end_date } = request.body ?? {};

      const { data: current, error: currentError } = await supabase
        .from('closings')
        .select('id, buyer_requirement_id, listing_id, completed_at')
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<{ id: string; buyer_requirement_id: string; listing_id: string; completed_at: string | null }>();

      if (currentError) {
        request.log.error(currentError);
        return reply.status(500).send({ error: 'Could not load the closing' });
      }
      if (!current) {
        return reply.status(404).send({ error: 'Closing not found in your workspace' });
      }
      if (current.completed_at) {
        return reply.status(400).send({ error: 'Cannot edit a completed closing' });
      }
      if (final_price !== undefined && (typeof final_price !== 'number' || !Number.isFinite(final_price) || final_price <= 0)) {
        return reply.status(400).send({ error: 'final_price must be a positive number' });
      }

      let completingListing: { id: string; status: string; listing_type: string } | undefined;
      if (completed) {
        const { data: listing, error: listingError } = await supabase
          .from('listings')
          .select('id, status, listing_type')
          .eq('id', current.listing_id)
          .eq('tenant_id', request.user!.tenantId)
          .maybeSingle<{ id: string; status: string; listing_type: string }>();

        if (listingError) {
          request.log.error(listingError);
          return reply.status(500).send({ error: 'Could not load the listing' });
        }
        if (!listing) {
          return reply.status(404).send({ error: 'Listing not found in your workspace' });
        }
        if (listing.listing_type === 'lease' && !lease_end_date) {
          return reply.status(400).send({ error: 'lease_end_date is required when the listing is a rental' });
        }
        completingListing = listing;
      }

      const updatePayload: Record<string, unknown> = {};
      if (final_price !== undefined) updatePayload.final_price = final_price;
      if (currency !== undefined) updatePayload.currency = currency;
      if (checklist_state !== undefined) updatePayload.checklist_state = checklist_state;
      if (completed) updatePayload.completed_at = new Date().toISOString();

      const { data: closing, error: updateError } = await supabase
        .from('closings')
        .update(updatePayload)
        .eq('id', current.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('*')
        .single();

      if (updateError || !closing) {
        request.log.error(updateError);
        return reply.status(500).send({ error: 'Could not update the closing' });
      }

      if (!completed) {
        return closing;
      }

      // Listing sold-flip is unconditional on completion (independent of the
      // lead's stage-advance below), same "flip if legal, silently skip
      // otherwise" precedent tb-transactions-offers-001 established for its
      // own under_offer flip.
      const { data: lead, error: leadError } = await supabase
        .from('buyer_requirements')
        .select('id, stage, contact_id')
        .eq('id', current.buyer_requirement_id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<{ id: string; stage: string; contact_id: string }>();

      if (leadError) {
        request.log.error(leadError, 'Closing completed, but could not load the lead');
      } else if (lead) {
        if (completingListing) {
          const legalNext = LISTING_STATUS_TRANSITIONS[completingListing.status] ?? [];
          if (legalNext.includes('sold')) {
            const { error: listingUpdateError } = await supabase
              .from('listings')
              .update({ status: 'sold', buyer_contact_id: lead.contact_id })
              .eq('id', completingListing.id)
              .eq('tenant_id', request.user!.tenantId);

            if (listingUpdateError) {
              request.log.error(listingUpdateError, 'Closing completed, but could not flip listing status');
            }
          }
        }

        const currentIndex = STAGE_ORDER.indexOf(lead.stage as (typeof STAGE_ORDER)[number]);
        if (currentIndex >= 0 && currentIndex < WON_STAGE_INDEX) {
          const { error: stageUpdateError } = await supabase
            .from('buyer_requirements')
            .update({
              stage: 'won',
              won_listing_id: current.listing_id,
              lease_end_date: completingListing?.listing_type === 'lease' ? lease_end_date : null,
            })
            .eq('id', lead.id)
            .eq('tenant_id', request.user!.tenantId);

          if (stageUpdateError) {
            request.log.error(stageUpdateError, 'Closing completed, but could not advance the lead stage');
          } else {
            try {
              await createStageChangeTask(supabase, request.user!.tenantId, request.user!.id, lead.id, 'won');
            } catch (taskError) {
              request.log.error(taskError, 'Could not create stage-change task');
            }
          }
        }
      }

      return closing;
    },
  );

  // Returns the most recent closing for this lead, if any -- same
  // most-recent-row convention tb-transactions-contract-001 established for
  // its own read endpoints.
  app.get<{ Params: { id: string } }>(
    '/buyer-requirements/:id/closing',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { data, error } = await supabase
        .from('closings')
        .select('*')
        .eq('buyer_requirement_id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not load the closing' });
      }
      return { closing: data ?? null };
    },
  );

  // Read-only from the listing's own detail view.
  app.get<{ Params: { id: string } }>('/listings/:id/closing', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('closings')
      .select('*')
      .eq('listing_id', request.params.id)
      .eq('tenant_id', request.user!.tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load the closing' });
    }
    return { closing: data ?? null };
  });
}
