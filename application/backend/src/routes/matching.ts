import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { canEditSetting } from '../lib/settingsDelegation.js';
import { createStageChangeTask } from '../lib/stageTaskGeneration.js';
import {
  scoreListing,
  TOGGLE_FIELDS,
  type MatchCandidate,
  type MatchableField,
  type RequirementLike,
} from '../lib/matching.js';

type SearchBody = { hard_filter_fields?: string[] };
type AdHocSearchBody = { hard_filter_fields?: string[]; requirement?: RequirementLike };
type MatchingSettingsBody = { match_score_threshold?: number };

type MatchResult = {
  source: 'inventory' | 'docket';
  listing_id: string;
  docket_id?: string;
  shared_by_handle?: string | null;
  property_title: string | null;
  price: number | null;
  price_currency: string | null;
  score: number;
  matched_fields: MatchableField[];
  excluded_fields: MatchableField[];
};

type InventoryListingRow = {
  id: string;
  listing_type: string;
  price: number;
  price_currency: string;
  status: string;
  properties: {
    title: string | null;
    type: string | null;
    city: string | null;
    province: string | null;
    floor_area_sqm: number | null;
    lot_area_sqm: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
  } | null;
};

// tb-buyer-leads-matching-001: shared by both /inquiries/:id/search and
// /buyer-requirements/:id/search -- the requirement's tenant's own active
// listings, scored via matching.ts, tagged source: 'inventory'.
async function scoreOwnInventory(
  supabase: ReturnType<typeof getScopedClient>,
  tenantId: string,
  requirement: RequirementLike,
  hardFilterFields: readonly Exclude<MatchableField, 'intent'>[],
): Promise<MatchResult[]> {
  const { data, error } = await supabase
    .from('listings')
    .select(
      'id, listing_type, price, price_currency, status, properties(title, type, city, province, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms)',
    )
    .eq('tenant_id', tenantId)
    .eq('status', 'active');

  if (error) throw error;

  const rows = (data ?? []) as unknown as InventoryListingRow[];
  const results: MatchResult[] = [];

  for (const row of rows) {
    const candidate: MatchCandidate = {
      listing_type: row.listing_type,
      property_type: row.properties?.type ?? null,
      price: row.price,
      city: row.properties?.city ?? null,
      province: row.properties?.province ?? null,
      floor_area_sqm: row.properties?.floor_area_sqm ?? null,
      lot_area_sqm: row.properties?.lot_area_sqm ?? null,
      bedrooms: row.properties?.bedrooms ?? null,
      bathrooms: row.properties?.bathrooms ?? null,
    };

    const scored = scoreListing(requirement, candidate, hardFilterFields);
    if (!scored) continue;

    results.push({
      source: 'inventory',
      listing_id: row.id,
      property_title: row.properties?.title ?? null,
      price: row.price,
      price_currency: row.price_currency,
      score: scored.score,
      matched_fields: scored.matched_fields,
      excluded_fields: scored.excluded_fields,
    });
  }

  return results;
}

// tb-buyer-leads-matching-001: this tenant's received, active dockets, with
// the underlying listing still status='active' (a revoked docket, or one
// whose source listing is no longer active, never appears -- see DoD).
// Reuses dockets.ts's cross-tenant read shape (identity-scoped docket rows on
// the scoped client, the live listing/property join on supabaseAdmin since
// the source tenant is never the caller's own). A candidate only carries the
// fields the sharer actually included -- everything else stays null, so
// matching.ts's "missing field excluded from weighted average" and "hard
// filter fails closed" rules apply exactly as they do for inventory.
async function scoreReceivedDockets(
  supabase: ReturnType<typeof getScopedClient>,
  callerId: string,
  requirement: RequirementLike,
  hardFilterFields: readonly Exclude<MatchableField, 'intent'>[],
): Promise<MatchResult[]> {
  const { data, error } = await supabase
    .from('listing_dockets')
    .select('id, shared_by, included_fields, source_listing_id')
    .eq('shared_with', callerId)
    .eq('status', 'active');

  if (error) throw error;

  const rows = data as unknown as Array<{
    id: string;
    shared_by: string;
    included_fields: string[];
    source_listing_id: string;
  }>;
  if (rows.length === 0) return [];

  const sharerIds = [...new Set(rows.map((row) => row.shared_by))];
  const { data: sharers, error: sharersError } = await supabaseAdmin
    .from('profiles')
    .select('id, handle')
    .in('id', sharerIds);
  if (sharersError) throw sharersError;
  const handleById = new Map((sharers ?? []).map((s) => [s.id, s.handle]));

  const listingIds = [...new Set(rows.map((row) => row.source_listing_id))];
  const { data: listingRows, error: listingsError } = await supabaseAdmin
    .from('listings')
    .select(
      'id, listing_type, price, price_currency, status, properties(title, type, city, province, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms)',
    )
    .in('id', listingIds)
    .eq('status', 'active');
  if (listingsError) throw listingsError;
  const listingById = new Map(((listingRows ?? []) as unknown as Array<InventoryListingRow & { id: string }>).map((l) => [l.id, l]));

  const results: MatchResult[] = [];
  for (const row of rows) {
    const listing = listingById.get(row.source_listing_id);
    if (!listing) continue; // revoked-in-effect: no longer active, or gone

    const included = new Set(row.included_fields);
    const candidate: MatchCandidate = {
      listing_type: included.has('listing_type') ? listing.listing_type : null,
      property_type: included.has('type') ? (listing.properties?.type ?? null) : null,
      price: included.has('price') ? listing.price : null,
      city: included.has('city') ? (listing.properties?.city ?? null) : null,
      province: included.has('province') ? (listing.properties?.province ?? null) : null,
      floor_area_sqm: included.has('floor_area_sqm') ? (listing.properties?.floor_area_sqm ?? null) : null,
      lot_area_sqm: included.has('lot_area_sqm') ? (listing.properties?.lot_area_sqm ?? null) : null,
      bedrooms: included.has('bedrooms') ? (listing.properties?.bedrooms ?? null) : null,
      bathrooms: included.has('bathrooms') ? (listing.properties?.bathrooms ?? null) : null,
    };

    const scored = scoreListing(requirement, candidate, hardFilterFields);
    if (!scored) continue;

    results.push({
      source: 'docket',
      listing_id: row.source_listing_id,
      docket_id: row.id,
      shared_by_handle: handleById.get(row.shared_by) ?? null,
      property_title: included.has('title') ? (listing.properties?.title ?? null) : null,
      price: included.has('price') ? listing.price : null,
      price_currency: included.has('price_currency') ? listing.price_currency : null,
      score: scored.score,
      matched_fields: scored.matched_fields,
      excluded_fields: scored.excluded_fields,
    });
  }

  return results;
}

function parseHardFilterFields(body: SearchBody | undefined, reply: { status: (code: number) => { send: (body: unknown) => unknown } } ): readonly Exclude<MatchableField, 'intent'>[] | null {
  const raw = body?.hard_filter_fields ?? [];
  if (!Array.isArray(raw)) return null;
  for (const field of raw) {
    if (!(TOGGLE_FIELDS as readonly string[]).includes(field)) return null;
  }
  return raw as Exclude<MatchableField, 'intent'>[];
}

export async function registerMatchingRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: SearchBody }>(
    '/inquiries/:id/search',
    { preHandler: requireAuth },
    async (request, reply) => {
      const hardFilterFields = parseHardFilterFields(request.body, reply);
      if (hardFilterFields === null) {
        return reply.status(400).send({ error: `hard_filter_fields must only contain: ${TOGGLE_FIELDS.join(', ')}` });
      }

      const supabase = getScopedClient(request);
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

      try {
        const [inventory, dockets] = await Promise.all([
          scoreOwnInventory(supabase, request.user!.tenantId, inquiry, hardFilterFields),
          scoreReceivedDockets(supabase, request.user!.id, inquiry, hardFilterFields),
        ]);
        const results = [...inventory, ...dockets].sort((a, b) => b.score - a.score);

        await supabase
          .from('inquiries')
          .update({ last_searched_at: new Date().toISOString() })
          .eq('id', inquiry.id)
          .eq('tenant_id', request.user!.tenantId);

        return { results };
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Could not run the search' });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: SearchBody }>(
    '/buyer-requirements/:id/search',
    { preHandler: requireAuth },
    async (request, reply) => {
      const hardFilterFields = parseHardFilterFields(request.body, reply);
      if (hardFilterFields === null) {
        return reply.status(400).send({ error: `hard_filter_fields must only contain: ${TOGGLE_FIELDS.join(', ')}` });
      }

      const supabase = getScopedClient(request);
      const { data: lead, error: leadError } = await supabase
        .from('buyer_requirements')
        .select('*')
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle();

      if (leadError) {
        request.log.error(leadError);
        return reply.status(500).send({ error: 'Could not load the lead' });
      }
      if (!lead) {
        return reply.status(404).send({ error: 'Lead not found in your workspace' });
      }

      try {
        const [inventory, dockets] = await Promise.all([
          scoreOwnInventory(supabase, request.user!.tenantId, lead, hardFilterFields),
          scoreReceivedDockets(supabase, request.user!.id, lead, hardFilterFields),
        ]);
        const results = [...inventory, ...dockets].sort((a, b) => b.score - a.score);

        const updateFields: Record<string, unknown> = { last_searched_at: new Date().toISOString() };
        // cap-buyer-leads-001's "How It Works" step 3: a successful search
        // bumps a fresh/stalled Lead into 'searching'. Leaves every other
        // stage untouched -- a Lead already past this point (options_sent
        // and beyond) isn't pulled backward by running another search.
        const stageChanged = lead.stage === 'registered' || lead.stage === 'stalled';
        if (stageChanged) {
          updateFields.stage = 'searching';
        }

        await supabase
          .from('buyer_requirements')
          .update(updateFields)
          .eq('id', lead.id)
          .eq('tenant_id', request.user!.tenantId);

        // tb-buyer-leads-stage-tasks-001: fire-and-log, doesn't fail the
        // search response that already succeeded.
        if (stageChanged) {
          try {
            await createStageChangeTask(supabase, request.user!.tenantId, request.user!.id, lead.id, 'searching');
          } catch (taskError) {
            request.log.error(taskError, 'Could not create stage-change task');
          }
        }

        return { results };
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Could not run the search' });
      }
    },
  );

  // tb-buyer-leads-matching-001: the standalone/ad-hoc variant of the two
  // record-scoped search endpoints above -- launched from the Search page's
  // nav entry with a blank form rather than pre-filled from an Inquiry/Lead.
  // No source record to attach last_searched_at or a stage-bump to, so this
  // endpoint skips both side effects entirely (resolves the open "recordless
  // search" decision the tracer bullet's own Technical Design flagged).
  app.post<{ Body: AdHocSearchBody }>('/search', { preHandler: requireAuth }, async (request, reply) => {
    const hardFilterFields = parseHardFilterFields(request.body, reply);
    if (hardFilterFields === null) {
      return reply.status(400).send({ error: `hard_filter_fields must only contain: ${TOGGLE_FIELDS.join(', ')}` });
    }
    const requirement = request.body?.requirement ?? {};

    const supabase = getScopedClient(request);
    try {
      const [inventory, dockets] = await Promise.all([
        scoreOwnInventory(supabase, request.user!.tenantId, requirement, hardFilterFields),
        scoreReceivedDockets(supabase, request.user!.id, requirement, hardFilterFields),
      ]);
      const results = [...inventory, ...dockets].sort((a, b) => b.score - a.score);
      return { results };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: 'Could not run the search' });
    }
  });

  app.get('/settings/matching', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('workspace_matching_settings')
      .select('match_score_threshold')
      .eq('tenant_id', request.user!.tenantId)
      .single();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load matching settings' });
    }

    const can_edit = await canEditSetting(supabase, request.user!.tenantId, request.user!.id, request.user!.role, 'matching');
    return { ...data, can_edit };
  });

  app.patch<{ Body: MatchingSettingsBody }>('/settings/matching', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const canEdit = await canEditSetting(supabase, request.user!.tenantId, request.user!.id, request.user!.role, 'matching');
    if (!canEdit) {
      return reply.status(403).send({ error: 'Only an admin or a delegated member can edit matching settings' });
    }

    const { match_score_threshold } = request.body ?? {};
    if (
      typeof match_score_threshold !== 'number' ||
      !Number.isInteger(match_score_threshold) ||
      match_score_threshold < 0 ||
      match_score_threshold > 100
    ) {
      return reply.status(400).send({ error: 'match_score_threshold must be an integer between 0 and 100' });
    }

    const { data, error } = await supabase
      .from('workspace_matching_settings')
      .update({ match_score_threshold })
      .eq('tenant_id', request.user!.tenantId)
      .select('match_score_threshold')
      .single();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not save matching settings' });
    }
    return { ...data, can_edit: true };
  });
}
