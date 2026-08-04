import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { createStageChangeTask } from '../lib/stageTaskGeneration.js';

// tb-transactions-contract-001: same STAGE_ORDER/forward-only pattern
// offers.ts established for the 'negotiating' advance -- local copy, not a
// shared util, for the same reason offers.ts gave (buyerRequirements.ts's
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
const CONTRACT_CLOSING_STAGE_INDEX = STAGE_ORDER.indexOf('contract_closing');

// Confirmed with the user: only 'signed' advances buyer_requirements.stage
// to 'contract_closing' -- 'sent' is still reversible and the stage name
// implies real commitment. 'void' means the deal fell through before
// signing and never advances the stage.
const SIGNING_TRANSITIONS: Record<string, readonly string[]> = {
  drafted: ['sent', 'void'],
  sent: ['signed', 'void'],
  signed: [],
  void: [],
};

type CreateContractBody = {
  offer_id?: string;
  agreed_price?: number;
  currency?: string;
  terms?: string;
};
type UpdateContractBody = {
  agreed_price?: number;
  currency?: string;
  terms?: string;
  signing_status?: string;
};

export async function registerContractsRoutes(app: FastifyInstance) {
  // tb-transactions-contract-001: create a contract seeded from an accepted
  // offer. buyer_requirement_id/listing_id are derived from the offer itself
  // (not trusted client input) -- an offer already carries both, and this
  // avoids a redundant payload that could be made to disagree with it.
  app.post<{ Body: CreateContractBody }>('/contracts', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { offer_id, agreed_price, currency, terms } = request.body ?? {};

    if (!offer_id) {
      return reply.status(400).send({ error: 'offer_id is required' });
    }

    const { data: offer, error: offerError } = await supabase
      .from('offers')
      .select('id, buyer_requirement_id, listing_id, status, amount, currency, terms')
      .eq('id', offer_id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle<{
        id: string;
        buyer_requirement_id: string;
        listing_id: string;
        status: string;
        amount: number;
        currency: string;
        terms: string | null;
      }>();

    if (offerError) {
      request.log.error(offerError);
      return reply.status(500).send({ error: 'Could not load the offer' });
    }
    if (!offer) {
      return reply.status(404).send({ error: 'Offer not found in your workspace' });
    }
    if (offer.status !== 'accepted') {
      return reply.status(400).send({ error: 'A contract can only be created from an accepted offer' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('contracts')
      .select('id')
      .eq('offer_id', offer.id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle<{ id: string }>();

    if (existingError) {
      request.log.error(existingError);
      return reply.status(500).send({ error: 'Could not check for an existing contract' });
    }
    if (existing) {
      return reply.status(400).send({ error: 'A contract already exists for this offer' });
    }

    if (agreed_price !== undefined && (typeof agreed_price !== 'number' || !Number.isFinite(agreed_price) || agreed_price <= 0)) {
      return reply.status(400).send({ error: 'agreed_price must be a positive number' });
    }

    const { data: contract, error: contractError } = await supabase
      .from('contracts')
      .insert({
        tenant_id: request.user!.tenantId,
        buyer_requirement_id: offer.buyer_requirement_id,
        listing_id: offer.listing_id,
        offer_id: offer.id,
        agreed_price: agreed_price ?? offer.amount,
        currency: currency ?? offer.currency,
        terms: terms ?? offer.terms ?? null,
        created_by: request.user!.id,
      })
      .select('*')
      .single();

    if (contractError || !contract) {
      request.log.error(contractError);
      return reply.status(500).send({ error: 'Could not create the contract' });
    }

    return reply.status(201).send(contract);
  });

  // tb-transactions-contract-001: edit terms and/or advance signing_status
  // in one call. Reaching 'signed' stamps signed_at and advances
  // buyer_requirements.stage to 'contract_closing' (forward-only, same
  // non-regression rule as tb-transactions-offers-001's 'negotiating' advance).
  app.patch<{ Params: { id: string }; Body: UpdateContractBody }>(
    '/contracts/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { agreed_price, currency, terms, signing_status } = request.body ?? {};

      const { data: current, error: currentError } = await supabase
        .from('contracts')
        .select('id, buyer_requirement_id, signing_status')
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<{ id: string; buyer_requirement_id: string; signing_status: string }>();

      if (currentError) {
        request.log.error(currentError);
        return reply.status(500).send({ error: 'Could not load the contract' });
      }
      if (!current) {
        return reply.status(404).send({ error: 'Contract not found in your workspace' });
      }

      if (agreed_price !== undefined && (typeof agreed_price !== 'number' || !Number.isFinite(agreed_price) || agreed_price <= 0)) {
        return reply.status(400).send({ error: 'agreed_price must be a positive number' });
      }

      if (signing_status !== undefined) {
        const legalNext = SIGNING_TRANSITIONS[current.signing_status] ?? [];
        if (!legalNext.includes(signing_status)) {
          return reply
            .status(400)
            .send({ error: `Cannot move signing_status from '${current.signing_status}' to '${signing_status}'` });
        }
      }

      const updatePayload: Record<string, unknown> = {};
      if (agreed_price !== undefined) updatePayload.agreed_price = agreed_price;
      if (currency !== undefined) updatePayload.currency = currency;
      if (terms !== undefined) updatePayload.terms = terms;
      if (signing_status !== undefined) {
        updatePayload.signing_status = signing_status;
        if (signing_status === 'signed') updatePayload.signed_at = new Date().toISOString();
      }

      const { data: contract, error: updateError } = await supabase
        .from('contracts')
        .update(updatePayload)
        .eq('id', current.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('*')
        .single();

      if (updateError || !contract) {
        request.log.error(updateError);
        return reply.status(500).send({ error: 'Could not update the contract' });
      }

      if (signing_status !== 'signed') {
        return contract;
      }

      const { data: lead, error: leadError } = await supabase
        .from('buyer_requirements')
        .select('id, stage')
        .eq('id', current.buyer_requirement_id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<{ id: string; stage: string }>();

      if (leadError) {
        request.log.error(leadError, 'Contract signed, but could not load the lead to advance its stage');
      } else if (lead) {
        const currentIndex = STAGE_ORDER.indexOf(lead.stage as (typeof STAGE_ORDER)[number]);
        if (currentIndex >= 0 && currentIndex < CONTRACT_CLOSING_STAGE_INDEX) {
          const { error: stageUpdateError } = await supabase
            .from('buyer_requirements')
            .update({ stage: 'contract_closing' })
            .eq('id', lead.id)
            .eq('tenant_id', request.user!.tenantId);

          if (stageUpdateError) {
            request.log.error(stageUpdateError, 'Contract signed, but could not advance the lead stage');
          } else {
            try {
              await createStageChangeTask(supabase, request.user!.tenantId, request.user!.id, lead.id, 'contract_closing');
            } catch (taskError) {
              request.log.error(taskError, 'Could not create stage-change task');
            }
          }
        }
      }

      return contract;
    },
  );

  // Returns the most recent contract for this lead, if any -- a lead can
  // only reasonably have one *current* contract at a time (a void'd one
  // followed by a fresh offer/contract cycle is a legitimate second row,
  // but the newest is always the one that matters to the UI).
  app.get<{ Params: { id: string } }>(
    '/buyer-requirements/:id/contract',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { data, error } = await supabase
        .from('contracts')
        .select('*')
        .eq('buyer_requirement_id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not load the contract' });
      }
      return { contract: data ?? null };
    },
  );

  // Read-only from the listing's own detail view.
  app.get<{ Params: { id: string } }>('/listings/:id/contract', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('contracts')
      .select('*')
      .eq('listing_id', request.params.id)
      .eq('tenant_id', request.user!.tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load the contract' });
    }
    return { contract: data ?? null };
  });
}
