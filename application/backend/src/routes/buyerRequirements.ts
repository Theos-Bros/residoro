import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { createStageChangeTask } from '../lib/stageTaskGeneration.js';

const STAGES = [
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
const INTENTS = ['buy', 'lease'] as const;
const PROPERTY_TYPES = [
  'condo_unit',
  'house_and_lot',
  'lot_only',
  'townhouse',
  'commercial',
  'warehouse',
  'agricultural',
  'industrial',
] as const;

const REQUIREMENT_FIELDS = [
  'intent',
  'property_type',
  'budget_min',
  'budget_max',
  'budget_currency',
  'target_city',
  'target_province',
  'floor_area_sqm_min',
  'lot_area_sqm_min',
  'storeys',
  'bedrooms',
  'bathrooms',
  'household_adults',
  'household_kids',
  'household_pets',
  'notes',
] as const;

type CreateLeadBody = {
  contact_id?: string;
  create_contact?: { name: string; phone?: string; email?: string };
} & Partial<Record<(typeof REQUIREMENT_FIELDS)[number], unknown>>;

type UpdateLeadBody = Partial<Record<(typeof REQUIREMENT_FIELDS)[number], unknown>> & { stage?: string };

type OptionsSentBody = { listing_ids?: string[]; scores?: Record<string, number> };
// tb-buyer-leads-revisit-page-001: lease_end_date is the lead's own client-facing
// lease term, captured only when the won deal is a rental -- see the mark-won
// handler below for the listing_type-conditional validation.
type MarkWonBody = { listing_id?: string; lease_end_date?: string };

function extractRequirementFields(body: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of REQUIREMENT_FIELDS) {
    if (body[key] !== undefined) fields[key] = body[key];
  }
  return fields;
}

function validateRequirementFields(fields: Record<string, unknown>): string | null {
  if (fields.intent !== undefined && !INTENTS.includes(fields.intent as (typeof INTENTS)[number])) {
    return `intent must be one of: ${INTENTS.join(', ')}`;
  }
  if (
    fields.property_type !== undefined &&
    !PROPERTY_TYPES.includes(fields.property_type as (typeof PROPERTY_TYPES)[number])
  ) {
    return `property_type must be one of: ${PROPERTY_TYPES.join(', ')}`;
  }
  return null;
}

export async function registerBuyerRequirementsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { stage?: string } }>('/buyer-requirements', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    let query = supabase
      .from('buyer_requirements')
      .select('*, contacts(name)')
      .eq('tenant_id', request.user!.tenantId)
      .order('created_at', { ascending: false });

    if (request.query.stage) {
      if (!STAGES.includes(request.query.stage as (typeof STAGES)[number])) {
        return reply.status(400).send({ error: `stage must be one of: ${STAGES.join(', ')}` });
      }
      query = query.eq('stage', request.query.stage);
    }

    const { data, error } = await query;
    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load leads' });
    }
    return { buyer_requirements: data ?? [] };
  });

  // tb-buyer-leads-schema-001: direct agent creation, not gated behind an
  // Inquiry -- an agent can register a Lead straight away if they already
  // know it's real (e.g. a referral), same as Inquiries aren't mandatory.
  app.post<{ Body: CreateLeadBody }>('/buyer-requirements', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { contact_id, create_contact, ...rest } = request.body ?? {};

    if (!contact_id && !create_contact) {
      return reply.status(400).send({ error: 'contact_id or create_contact is required' });
    }
    if (contact_id && create_contact) {
      return reply.status(400).send({ error: 'contact_id and create_contact cannot both be given' });
    }
    if (create_contact && !create_contact.name) {
      return reply.status(400).send({ error: 'create_contact.name is required' });
    }

    const requirementFields = extractRequirementFields(rest as Record<string, unknown>);
    const validationError = validateRequirementFields(requirementFields);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    let resolvedContactId = contact_id;
    if (create_contact) {
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          tenant_id: request.user!.tenantId,
          created_by: request.user!.id,
          name: create_contact.name,
          phone: create_contact.phone,
          email: create_contact.email,
          type: 'buyer_lead',
        })
        .select('id')
        .single();

      if (contactError || !contact) {
        request.log.error(contactError);
        return reply.status(500).send({ error: 'Could not create the contact' });
      }
      resolvedContactId = contact.id;
    } else {
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .select('id')
        .eq('id', contact_id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle();

      if (contactError) {
        request.log.error(contactError);
        return reply.status(500).send({ error: 'Could not verify the contact' });
      }
      if (!contact) {
        return reply.status(404).send({ error: 'Contact not found in your workspace' });
      }
    }

    const { data, error } = await supabase
      .from('buyer_requirements')
      .insert({
        tenant_id: request.user!.tenantId,
        created_by: request.user!.id,
        contact_id: resolvedContactId,
        ...requirementFields,
      })
      .select('*, contacts(name)')
      .single();

    if (error || !data) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not create the lead' });
    }
    return reply.status(201).send(data);
  });

  // tb-buyer-leads-revisit-page-001: every won lead with a captured lease-end
  // date, for the Revisit page (leased-deal renewal tracking). Registered as
  // a static path ahead of the /:id param route below so it's never shadowed.
  // Filters on both stage='won' and lease_end_date not null -- Decision #3
  // (buyer-leads-schema-001) allows a lead's stage to be freely reverted, so
  // a lease_end_date set during a since-undone win shouldn't surface here.
  // Sorting (soonest lease-end first) and Expired/Expiring-Soon/Active
  // bucketing both happen client-side in the Revisit page, not here.
  app.get('/buyer-requirements/revisit', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('buyer_requirements')
      .select(
        'id, lease_end_date, contacts(name), listing:listings!won_listing_id(listing_type, price, price_currency, properties(title, address, city, province))',
      )
      .eq('tenant_id', request.user!.tenantId)
      .eq('stage', 'won')
      .not('lease_end_date', 'is', null)
      .order('lease_end_date', { ascending: true });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load leased deals' });
    }
    return { revisit_leads: data ?? [] };
  });

  app.get<{ Params: { id: string } }>('/buyer-requirements/:id', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('buyer_requirements')
      .select('*, contacts(name), buyer_requirement_matches(id, listing_id, score, sent_at)')
      .eq('id', request.params.id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load the lead' });
    }
    if (!data) {
      return reply.status(404).send({ error: 'Lead not found in your workspace' });
    }
    return data;
  });

  // tb-buyer-leads-schema-001: any stage value is a legal PATCH target,
  // forward or backward -- no transition graph (Decision #3).
  app.patch<{ Params: { id: string }; Body: UpdateLeadBody }>(
    '/buyer-requirements/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { stage, ...rest } = request.body ?? {};

      const updateFields: Record<string, unknown> = extractRequirementFields(rest as Record<string, unknown>);
      const validationError = validateRequirementFields(updateFields);
      if (validationError) {
        return reply.status(400).send({ error: validationError });
      }

      // tb-buyer-leads-stage-tasks-001: need the pre-update stage to tell a
      // real change from a no-op PATCH that sets stage to its current value.
      let priorStage: string | undefined;
      if (stage !== undefined) {
        if (!STAGES.includes(stage as (typeof STAGES)[number])) {
          return reply.status(400).send({ error: `stage must be one of: ${STAGES.join(', ')}` });
        }
        const { data: current, error: currentError } = await supabase
          .from('buyer_requirements')
          .select('stage')
          .eq('id', request.params.id)
          .eq('tenant_id', request.user!.tenantId)
          .maybeSingle<{ stage: string }>();
        if (currentError) {
          request.log.error(currentError);
          return reply.status(500).send({ error: 'Could not load the lead' });
        }
        if (!current) {
          return reply.status(404).send({ error: 'Lead not found in your workspace' });
        }
        priorStage = current.stage;
        updateFields.stage = stage;
      }

      const { data, error } = await supabase
        .from('buyer_requirements')
        .update(updateFields)
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('*, contacts(name)')
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update the lead' });
      }
      if (!data) {
        return reply.status(404).send({ error: 'Lead not found in your workspace' });
      }

      // tb-buyer-leads-stage-tasks-001: fire-and-log, doesn't fail the
      // request that already successfully changed stage -- the task is a
      // side effect of the stage change, not a precondition for it.
      if (stage !== undefined && priorStage !== undefined && priorStage !== stage) {
        try {
          await createStageChangeTask(supabase, request.user!.tenantId, request.user!.id, data.id, stage);
        } catch (taskError) {
          request.log.error(taskError, 'Could not create stage-change task');
        }
      }

      return data;
    },
  );

  // tb-buyer-leads-schema-001: plain, unranked options picker -- no score
  // available here, so scores[listing_id] is absent and the insert falls back
  // to null. tb-buyer-leads-matching-001 (TB2)'s ranked Search page passes a
  // real score per listing_id instead. Each listing_id is re-verified
  // tenant-owned + active, same "never trust the client" as every other write
  // route.
  //
  // tb-buyer-leads-matching-001: a listing_id not found in the caller's own
  // active inventory is also accepted if it's the source_listing_id of an
  // active docket shared with the caller (identity-scoped read, same as
  // dockets.ts) whose underlying listing is still status='active' on
  // supabaseAdmin -- otherwise the Search page's docket-sourced results could
  // never actually be sent as an option, contradicting TB2's own "identical
  // to an inventory-sourced one" Definition of Done. Never writes to
  // listing_dockets itself; purely a read-only eligibility check.
  app.post<{ Params: { id: string }; Body: OptionsSentBody }>(
    '/buyer-requirements/:id/options-sent',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { listing_ids, scores } = request.body ?? {};

      if (!listing_ids || !Array.isArray(listing_ids) || listing_ids.length === 0) {
        return reply.status(400).send({ error: 'listing_ids is required and must be a non-empty array' });
      }

      const { data: lead, error: leadError } = await supabase
        .from('buyer_requirements')
        .select('id, stage')
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<{ id: string; stage: string }>();

      if (leadError) {
        request.log.error(leadError);
        return reply.status(500).send({ error: 'Could not load the lead' });
      }
      if (!lead) {
        return reply.status(404).send({ error: 'Lead not found in your workspace' });
      }

      const { data: listings, error: listingsError } = await supabase
        .from('listings')
        .select('id')
        .in('id', listing_ids)
        .eq('tenant_id', request.user!.tenantId)
        .eq('status', 'active');

      if (listingsError) {
        request.log.error(listingsError);
        return reply.status(500).send({ error: 'Could not verify the listings' });
      }

      const validIds = new Set((listings ?? []).map((l) => l.id));
      const remainingIds = listing_ids.filter((id) => !validIds.has(id));

      if (remainingIds.length > 0) {
        const { data: dockets, error: docketsError } = await supabase
          .from('listing_dockets')
          .select('source_listing_id')
          .in('source_listing_id', remainingIds)
          .eq('shared_with', request.user!.id)
          .eq('status', 'active');

        if (docketsError) {
          request.log.error(docketsError);
          return reply.status(500).send({ error: 'Could not verify shared dockets' });
        }

        const docketListingIds = [...new Set((dockets ?? []).map((d) => d.source_listing_id))];
        if (docketListingIds.length > 0) {
          const { data: docketListings, error: docketListingsError } = await supabaseAdmin
            .from('listings')
            .select('id')
            .in('id', docketListingIds)
            .eq('status', 'active');

          if (docketListingsError) {
            request.log.error(docketListingsError);
            return reply.status(500).send({ error: 'Could not verify shared listings' });
          }
          for (const row of docketListings ?? []) validIds.add(row.id);
        }
      }

      const invalidIds = listing_ids.filter((id) => !validIds.has(id));
      if (invalidIds.length > 0) {
        return reply
          .status(400)
          .send({ error: `Listings not found, not active, or not shared with you: ${invalidIds.join(', ')}` });
      }

      const { data: matches, error: matchError } = await supabase
        .from('buyer_requirement_matches')
        .insert(
          listing_ids.map((listing_id) => ({
            tenant_id: request.user!.tenantId,
            buyer_requirement_id: lead.id,
            listing_id,
            score: scores?.[listing_id] ?? null,
            created_by: request.user!.id,
          })),
        )
        .select('*');

      if (matchError) {
        request.log.error(matchError);
        return reply.status(500).send({ error: 'Could not record the sent options' });
      }

      const { data: updated, error: updateError } = await supabase
        .from('buyer_requirements')
        .update({ stage: 'options_sent' })
        .eq('id', lead.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('*, contacts(name)')
        .single();

      if (updateError || !updated) {
        request.log.error(updateError);
        return reply.status(500).send({ error: 'Options recorded, but could not update the lead stage' });
      }

      if (lead.stage !== 'options_sent') {
        try {
          await createStageChangeTask(supabase, request.user!.tenantId, request.user!.id, lead.id, 'options_sent');
        } catch (taskError) {
          request.log.error(taskError, 'Could not create stage-change task');
        }
      }

      return reply.status(201).send({ buyer_requirement: updated, matches: matches ?? [] });
    },
  );

  // tb-buyer-leads-schema-001: bookkeeping-only. Never calls PATCH
  // /listings/:id and never writes listings.buyer_contact_id -- that contract
  // belongs entirely to tb-crm-buyer-001, untouched by this route.
  app.patch<{ Params: { id: string }; Body: MarkWonBody }>(
    '/buyer-requirements/:id/mark-won',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { listing_id, lease_end_date } = request.body ?? {};

      if (!listing_id) {
        return reply.status(400).send({ error: 'listing_id is required' });
      }

      const { data: match, error: matchError } = await supabase
        .from('buyer_requirement_matches')
        .select('id')
        .eq('buyer_requirement_id', request.params.id)
        .eq('listing_id', listing_id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle();

      if (matchError) {
        request.log.error(matchError);
        return reply.status(500).send({ error: 'Could not verify the listing was sent as an option' });
      }
      if (!match) {
        return reply.status(400).send({ error: 'listing_id was not sent as an option to this lead' });
      }

      // tb-buyer-leads-revisit-page-001: whether lease_end_date is required
      // is derived from the won listing's own listing_type, not passed by the
      // client -- a rent-type won deal is a lease and needs a lease-end date
      // for the Revisit page; a sale-type deal never gets one, so any
      // lease_end_date sent alongside a sale is silently dropped (leniency
      // call from the tracer bullet doc: don't error on it, just ignore it).
      const { data: wonListing, error: listingError } = await supabase
        .from('listings')
        .select('listing_type')
        .eq('id', listing_id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<{ listing_type: string }>();

      if (listingError) {
        request.log.error(listingError);
        return reply.status(500).send({ error: 'Could not verify the listing type' });
      }
      if (!wonListing) {
        return reply.status(404).send({ error: 'Listing not found in your workspace' });
      }

      const isRental = wonListing.listing_type === 'rent';
      if (isRental && !lease_end_date) {
        return reply.status(400).send({ error: 'lease_end_date is required when the won listing is a rental' });
      }

      const { data: before, error: beforeError } = await supabase
        .from('buyer_requirements')
        .select('stage')
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<{ stage: string }>();

      if (beforeError) {
        request.log.error(beforeError);
        return reply.status(500).send({ error: 'Could not load the lead' });
      }
      if (!before) {
        return reply.status(404).send({ error: 'Lead not found in your workspace' });
      }

      const { data, error } = await supabase
        .from('buyer_requirements')
        .update({
          won_listing_id: listing_id,
          stage: 'won',
          lease_end_date: isRental ? lease_end_date : null,
        })
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('*, contacts(name)')
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not mark the lead won' });
      }
      if (!data) {
        return reply.status(404).send({ error: 'Lead not found in your workspace' });
      }

      if (before.stage !== 'won') {
        try {
          await createStageChangeTask(supabase, request.user!.tenantId, request.user!.id, request.params.id, 'won');
        } catch (taskError) {
          request.log.error(taskError, 'Could not create stage-change task');
        }
      }

      return data;
    },
  );
}
