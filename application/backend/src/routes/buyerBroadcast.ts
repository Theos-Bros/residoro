import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { mergeTemplate } from './shareText.js';

type RequirementRow = {
  intent: string | null;
  property_type: string | null;
  budget_min: number | null;
  budget_max: number | null;
  budget_currency: string | null;
  target_city: string | null;
  target_province: string | null;
  floor_area_sqm_min: number | null;
  lot_area_sqm_min: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
};

const REQUIREMENT_SELECT =
  'intent, property_type, budget_min, budget_max, budget_currency, target_city, target_province, floor_area_sqm_min, lot_area_sqm_min, bedrooms, bathrooms';

function formatBudgetRange(min: number | null, max: number | null, currency: string | null): string {
  if (min == null && max == null) return '';
  const cur = currency ?? 'PHP';
  if (min != null && max != null) return `${cur} ${min.toLocaleString()} – ${max.toLocaleString()}`;
  return `${cur} ${(min ?? max)!.toLocaleString()}`;
}

// tb-buyer-leads-broadcast-001: mirrors shareText.ts's commonFields() --
// derived merge fields (budget_range) rather than exposing raw columns 1:1.
// contact_name is only ever populated for a Lead (buyer_requirements has no
// buyer_name column of its own -- display name always derives from
// contact_id -> contacts.name, per tb-buyer-leads-schema-001 Decision #3).
function buildBroadcastFields(record: RequirementRow, contactName?: string | null): Record<string, string> {
  return {
    intent: record.intent ?? '',
    property_type: record.property_type ?? '',
    budget_min: record.budget_min?.toLocaleString() ?? '',
    budget_max: record.budget_max?.toLocaleString() ?? '',
    budget_range: formatBudgetRange(record.budget_min, record.budget_max, record.budget_currency),
    target_city: record.target_city ?? '',
    target_province: record.target_province ?? '',
    floor_area_sqm_min: record.floor_area_sqm_min?.toString() ?? '',
    lot_area_sqm_min: record.lot_area_sqm_min?.toString() ?? '',
    bedrooms: record.bedrooms?.toString() ?? '',
    bathrooms: record.bathrooms?.toString() ?? '',
    contact_name: contactName ?? '',
  };
}

// tb-buyer-leads-broadcast-001: text is null / template_configured is false
// when the tenant hasn't authored a buyer_wanted_share_template yet -- never
// falls back to merging against an empty-string template, so the frontend
// can show a clear "set one up in Settings" prompt instead of a blank copy.
async function loadBuyerWantedTemplate(
  supabase: ReturnType<typeof getScopedClient>,
  tenantId: string,
): Promise<{ template: string | null } | { error: unknown }> {
  const { data, error } = await supabase
    .from('workspace_sharing_settings')
    .select('buyer_wanted_share_template')
    .eq('tenant_id', tenantId)
    .single();
  if (error) return { error };
  return { template: data?.buyer_wanted_share_template ?? null };
}

export async function registerBuyerBroadcastRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/inquiries/:id/broadcast-text',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { data: inquiry, error } = await supabase
        .from('inquiries')
        .select(REQUIREMENT_SELECT)
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<RequirementRow>();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not load the inquiry' });
      }
      if (!inquiry) {
        return reply.status(404).send({ error: 'Inquiry not found in your workspace' });
      }

      const templateResult = await loadBuyerWantedTemplate(supabase, request.user!.tenantId);
      if ('error' in templateResult) {
        request.log.error(templateResult.error);
        return reply.status(500).send({ error: 'Could not load the Buyer Wanted template' });
      }
      if (!templateResult.template) {
        return { text: null, template_configured: false };
      }

      return {
        text: mergeTemplate(templateResult.template, buildBroadcastFields(inquiry)),
        template_configured: true,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/buyer-requirements/:id/broadcast-text',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { data: lead, error } = await supabase
        .from('buyer_requirements')
        .select(`${REQUIREMENT_SELECT}, contacts(name)`)
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<RequirementRow & { contacts: { name: string } | null }>();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not load the lead' });
      }
      if (!lead) {
        return reply.status(404).send({ error: 'Lead not found in your workspace' });
      }

      const templateResult = await loadBuyerWantedTemplate(supabase, request.user!.tenantId);
      if ('error' in templateResult) {
        request.log.error(templateResult.error);
        return reply.status(500).send({ error: 'Could not load the Buyer Wanted template' });
      }
      if (!templateResult.template) {
        return { text: null, template_configured: false };
      }

      return {
        text: mergeTemplate(templateResult.template, buildBroadcastFields(lead, lead.contacts?.name)),
        template_configured: true,
      };
    },
  );
}
