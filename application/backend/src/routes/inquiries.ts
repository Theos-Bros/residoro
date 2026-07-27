import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';

const STAGES = ['to_probe', 'probing', 'not_qualified', 'qualified'] as const;
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

type CreateInquiryBody = {
  buyer_name?: string;
  buyer_phone?: string;
  buyer_email?: string;
  buyer_address?: string;
  source?: string;
} & Partial<Record<(typeof REQUIREMENT_FIELDS)[number], unknown>>;

type UpdateInquiryBody = CreateInquiryBody & { stage?: string };

type QualifyInquiryBody = {
  contact_id?: string;
  create_contact?: { name: string; phone?: string; email?: string };
};

// tb-buyer-leads-schema-001: mirrors budget_min/budget_max etc across
// inquiries and buyer_requirements -- both tables share the same requirement
// field shape by design (Decision #2 in the tracer bullet: search must be
// usable directly on an Inquiry, not gated behind Lead promotion).
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

export async function registerInquiriesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { stage?: string; include_archived?: string } }>(
    '/inquiries',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      let query = supabase
        .from('inquiries')
        .select('*')
        .eq('tenant_id', request.user!.tenantId)
        .order('created_at', { ascending: false });

      if (request.query.stage) {
        if (!STAGES.includes(request.query.stage as (typeof STAGES)[number])) {
          return reply.status(400).send({ error: `stage must be one of: ${STAGES.join(', ')}` });
        }
        query = query.eq('stage', request.query.stage);
      }
      if (request.query.include_archived !== 'true') {
        query = query.is('archived_at', null);
      }

      const { data, error } = await query;
      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not load inquiries' });
      }
      return { inquiries: data ?? [] };
    },
  );

  // tb-buyer-leads-schema-001: stage always defaults 'to_probe' server-side --
  // never accepted from the client, so a spam/bogus inquiry can't be
  // self-declared 'qualified'.
  app.post<{ Body: CreateInquiryBody }>('/inquiries', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { buyer_name, buyer_phone, buyer_email, buyer_address, source, ...rest } = request.body ?? {};

    const requirementFields = extractRequirementFields(rest as Record<string, unknown>);
    const validationError = validateRequirementFields(requirementFields);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    const { data, error } = await supabase
      .from('inquiries')
      .insert({
        tenant_id: request.user!.tenantId,
        created_by: request.user!.id,
        stage: 'to_probe',
        buyer_name,
        buyer_phone,
        buyer_email,
        buyer_address,
        source,
        ...requirementFields,
      })
      .select('*')
      .single();

    if (error || !data) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not create the inquiry' });
    }
    return reply.status(201).send(data);
  });

  app.get<{ Params: { id: string } }>('/inquiries/:id', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('inquiries')
      .select('*')
      .eq('id', request.params.id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load the inquiry' });
    }
    if (!data) {
      return reply.status(404).send({ error: 'Inquiry not found in your workspace' });
    }
    return data;
  });

  // tb-buyer-leads-schema-001: any stage value is a legal PATCH target
  // (Decision #3 -- no transition graph like listings.ts's STATUS_TRANSITIONS).
  // Moving to 'probing' with probed_by unset auto-sets it to the caller.
  app.patch<{ Params: { id: string }; Body: UpdateInquiryBody }>(
    '/inquiries/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { stage, buyer_name, buyer_phone, buyer_email, buyer_address, source, ...rest } = request.body ?? {};

      const updateFields: Record<string, unknown> = extractRequirementFields(rest as Record<string, unknown>);
      const validationError = validateRequirementFields(updateFields);
      if (validationError) {
        return reply.status(400).send({ error: validationError });
      }

      if (buyer_name !== undefined) updateFields.buyer_name = buyer_name;
      if (buyer_phone !== undefined) updateFields.buyer_phone = buyer_phone;
      if (buyer_email !== undefined) updateFields.buyer_email = buyer_email;
      if (buyer_address !== undefined) updateFields.buyer_address = buyer_address;
      if (source !== undefined) updateFields.source = source;

      if (stage !== undefined) {
        if (!STAGES.includes(stage as (typeof STAGES)[number])) {
          return reply.status(400).send({ error: `stage must be one of: ${STAGES.join(', ')}` });
        }
        updateFields.stage = stage;

        if (stage === 'probing') {
          const { data: current } = await supabase
            .from('inquiries')
            .select('probed_by')
            .eq('id', request.params.id)
            .eq('tenant_id', request.user!.tenantId)
            .maybeSingle();
          if (current && !current.probed_by) {
            updateFields.probed_by = request.user!.id;
          }
        }
      }

      const { data, error } = await supabase
        .from('inquiries')
        .update(updateFields)
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('*')
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update the inquiry' });
      }
      if (!data) {
        return reply.status(404).send({ error: 'Inquiry not found in your workspace' });
      }
      return data;
    },
  );

  // tb-buyer-leads-schema-001: promotes an Inquiry into a real Lead. One-way
  // door -- 409 if the inquiry is already qualified/not_qualified (mirrors
  // tb-crm-buyer-001's sold-is-terminal precedent). Copies every requirement
  // field across so the new Lead starts with the same data captured at intake.
  app.post<{ Params: { id: string }; Body: QualifyInquiryBody }>(
    '/inquiries/:id/qualify',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { contact_id, create_contact } = request.body ?? {};

      if (!contact_id && !create_contact) {
        return reply.status(400).send({ error: 'contact_id or create_contact is required' });
      }
      if (contact_id && create_contact) {
        return reply.status(400).send({ error: 'contact_id and create_contact cannot both be given' });
      }
      if (create_contact && !create_contact.name) {
        return reply.status(400).send({ error: 'create_contact.name is required' });
      }

      const { data: inquiry, error: inquiryError } = await supabase
        .from('inquiries')
        .select('*')
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle();

      if (inquiryError) {
        request.log.error(inquiryError);
        return reply.status(500).send({ error: 'Could not load the inquiry' });
      }
      if (!inquiry) {
        return reply.status(404).send({ error: 'Inquiry not found in your workspace' });
      }
      if (inquiry.stage === 'qualified' || inquiry.stage === 'not_qualified') {
        return reply.status(409).send({ error: `Inquiry is already ${inquiry.stage}` });
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

      const requirementFields = extractRequirementFields(inquiry as Record<string, unknown>);
      // buyer_requirements.intent is NOT NULL DEFAULT 'buy' -- inquiries.intent
      // is nullable (a caller may not have captured it yet at intake time).
      // Copying an explicit null here would override the target column's
      // default and violate its NOT NULL constraint, so fall back to 'buy'
      // the same way the schema itself would if the column were omitted.
      if (!requirementFields.intent) requirementFields.intent = 'buy';

      const { data: lead, error: leadError } = await supabase
        .from('buyer_requirements')
        .insert({
          tenant_id: request.user!.tenantId,
          created_by: request.user!.id,
          contact_id: resolvedContactId,
          source_inquiry_id: inquiry.id,
          stage: 'registered',
          ...requirementFields,
        })
        .select('*')
        .single();

      if (leadError || !lead) {
        request.log.error(leadError);
        return reply.status(500).send({ error: 'Could not create the lead' });
      }

      const { data: updatedInquiry, error: updateError } = await supabase
        .from('inquiries')
        .update({ stage: 'qualified', promoted_lead_id: lead.id })
        .eq('id', inquiry.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('*')
        .single();

      if (updateError || !updatedInquiry) {
        request.log.error(updateError);
        return reply.status(500).send({ error: 'Lead created, but could not update the inquiry' });
      }

      return reply.status(201).send({ inquiry: updatedInquiry, lead });
    },
  );

  app.patch<{ Params: { id: string } }>('/inquiries/:id/archive', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('inquiries')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', request.params.id)
      .eq('tenant_id', request.user!.tenantId)
      .select('*')
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not archive the inquiry' });
    }
    if (!data) {
      return reply.status(404).send({ error: 'Inquiry not found in your workspace' });
    }
    return data;
  });

  app.delete<{ Params: { id: string } }>('/inquiries/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user!.role !== 'admin') {
      return reply.status(403).send({ error: 'Only an admin can delete an inquiry' });
    }

    const supabase = getScopedClient(request);
    const { error } = await supabase
      .from('inquiries')
      .delete()
      .eq('id', request.params.id)
      .eq('tenant_id', request.user!.tenantId);

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not delete the inquiry' });
    }
    return reply.status(204).send();
  });
}
