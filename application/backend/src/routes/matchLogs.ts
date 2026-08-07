import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { mergeTemplate } from './shareText.js';
import { resolveAndValidateMatchItems, type ResolvedMatchItem } from '../lib/matchCandidates.js';
import { createItineraryDoc, isGoogleDocsConfigured, shareItineraryDoc, type ItineraryItem } from '../lib/googleDocs.js';

type ItemsBody = { items?: unknown };

function sourceNoteFor(item: ResolvedMatchItem): string {
  if (item.source === 'inventory') return 'Your inventory';
  if (item.source === 'project_unit') return 'Project inventory — not yet listed';
  return `Shared by @${item.shared_by_handle ?? 'unknown'}`;
}

function itineraryDetailFor(item: ResolvedMatchItem): string {
  const price = item.fields.price != null ? `${item.fields.price_currency} ${item.fields.price.toLocaleString()}` : 'Price not shared';
  const location = [item.fields.address, item.fields.city, item.fields.province].filter(Boolean).join(', ');
  return `${price} — ${item.fields.type || 'property'}${location ? ` — ${location}` : ''}`;
}

async function loadLead(supabase: ReturnType<typeof getScopedClient>, tenantId: string, leadId: string) {
  const { data, error } = await supabase
    .from('buyer_requirements')
    .select('id, contacts(name)')
    .eq('id', leadId)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ id: string; contacts: { name: string } | null }>();
  if (error) throw error;
  return data;
}

// tb-buyer-leads-match-itinerary-001: three independently-useful actions on
// a buyer_requirement's matched candidates (the Search page's results), plus
// a read of the persisted match-log history. Only "log match" writes
// anything -- copy-as-text and generate-itinerary are pure read/generate
// actions per the tracer bullet's own semantic_scope ("logging a match only
// creates a persisted database record ... document generation is exclusively
// the separate copy-as-text and itinerary features").
export async function registerMatchLogRoutes(app: FastifyInstance) {
  // 1. Log match -- persists a match_log + its items, many per lead.
  app.post<{ Params: { id: string }; Body: ItemsBody }>(
    '/buyer-requirements/:id/match-logs',
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

      let resolved;
      try {
        resolved = await resolveAndValidateMatchItems(supabase, tenantId, request.user!.id, request.body?.items);
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Could not verify the matched items' });
      }
      if (!resolved.ok) return reply.status(400).send({ error: resolved.error });

      const { data: log, error: logError } = await supabase
        .from('buyer_requirement_match_logs')
        .insert({ tenant_id: tenantId, buyer_requirement_id: lead.id, logged_by: request.user!.id })
        .select('id, created_at, logged_by')
        .single();
      if (logError || !log) {
        request.log.error(logError);
        return reply.status(500).send({ error: 'Could not log this match' });
      }

      const { data: items, error: itemsError } = await supabase
        .from('buyer_requirement_match_log_items')
        .insert(
          resolved.items.map((item) => ({
            match_log_id: log.id,
            listing_id: item.listing_id,
            property_id: item.property_id,
          })),
        )
        .select('id, listing_id, property_id');
      if (itemsError) {
        request.log.error(itemsError);
        // The log row already exists without items -- surface this clearly
        // rather than leaving an orphaned, empty log silently in place.
        return reply.status(500).send({ error: 'Match logged, but could not save its items' });
      }

      return reply.status(201).send({
        match_log: {
          id: log.id,
          created_at: log.created_at,
          logged_by: log.logged_by,
          items: (items ?? []).map((row, i) => ({
            id: row.id,
            listing_id: row.listing_id,
            property_id: row.property_id,
            title: resolved.items[i].fields.title,
            source: resolved.items[i].source,
          })),
        },
      });
    },
  );

  // 2. Match history -- read-only, whole-brokerage-visible (no agent
  // assignment concept in cap-buyer-leads-001), used by LeadDetailPanel's
  // running history section. Resolves listing/property display titles via
  // supabaseAdmin because a docket-sourced item's underlying listing belongs
  // to a DIFFERENT tenant -- the caller's own scoped client (RLS) can never
  // see it directly, same reasoning matching.ts's scoreReceivedDockets
  // already documents for cross-tenant listing reads.
  app.get<{ Params: { id: string } }>(
    '/buyer-requirements/:id/match-logs',
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

      const { data: logs, error: logsError } = await supabase
        .from('buyer_requirement_match_logs')
        .select('id, created_at, logged_by, buyer_requirement_match_log_items(id, listing_id, property_id)')
        .eq('buyer_requirement_id', lead.id)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (logsError) {
        request.log.error(logsError);
        return reply.status(500).send({ error: 'Could not load match history' });
      }

      const allItems = (logs ?? []).flatMap(
        (l) => l.buyer_requirement_match_log_items as Array<{ id: string; listing_id: string | null; property_id: string | null }>,
      );
      const listingIds = [...new Set(allItems.map((i) => i.listing_id).filter((v): v is string => !!v))];
      const propertyIds = [...new Set(allItems.map((i) => i.property_id).filter((v): v is string => !!v))];
      const loggedByIds = [...new Set((logs ?? []).map((l) => l.logged_by).filter((v): v is string => !!v))];

      const [{ data: listingRows }, { data: propertyRows }, { data: profileRows }] = await Promise.all([
        listingIds.length > 0
          ? supabaseAdmin.from('listings').select('id, properties(title)').in('id', listingIds)
          : Promise.resolve({ data: [] as Array<{ id: string; properties: { title: string | null } | null }> }),
        propertyIds.length > 0
          ? supabaseAdmin.from('properties').select('id, title, projects(name)').in('id', propertyIds)
          : Promise.resolve({ data: [] as Array<{ id: string; title: string; projects: { name: string | null } | null }> }),
        loggedByIds.length > 0
          ? supabaseAdmin.from('profiles').select('id, handle').in('id', loggedByIds)
          : Promise.resolve({ data: [] as Array<{ id: string; handle: string }> }),
      ]);

      const listingTitleById = new Map((listingRows ?? []).map((r: any) => [r.id, r.properties?.title ?? '(untitled)']));
      const propertyTitleById = new Map(
        (propertyRows ?? []).map((r: any) => [r.id, `${r.title} (${r.projects?.name ?? 'Project'})`]),
      );
      const handleById = new Map((profileRows ?? []).map((r: any) => [r.id, r.handle]));

      const match_logs = (logs ?? []).map((l) => ({
        id: l.id,
        created_at: l.created_at,
        logged_by: l.logged_by,
        logged_by_handle: l.logged_by ? (handleById.get(l.logged_by) ?? null) : null,
        items: (l.buyer_requirement_match_log_items as Array<{ id: string; listing_id: string | null; property_id: string | null }>).map(
          (item) => ({
            id: item.id,
            listing_id: item.listing_id,
            property_id: item.property_id,
            title: item.listing_id
              ? (listingTitleById.get(item.listing_id) ?? '(listing no longer available)')
              : (propertyTitleById.get(item.property_id!) ?? '(property no longer available)'),
          }),
        ),
      }));

      return { match_logs };
    },
  );

  // 3. Copy as text -- tb-distribution-share-text-001's merge-field template
  // mechanism, reused verbatim (mergeTemplate + workspace_sharing_settings'
  // public_share_template), applied per matched item and joined. Public
  // audience is the correct template here (not co_broker/internal) -- these
  // are candidates the agent is about to hand the buyer, i.e. exactly what
  // "public" already means elsewhere in this codebase. No persistence.
  app.post<{ Params: { id: string }; Body: ItemsBody }>(
    '/buyer-requirements/:id/match-copy-text',
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

      let resolved;
      try {
        resolved = await resolveAndValidateMatchItems(supabase, tenantId, request.user!.id, request.body?.items);
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Could not verify the matched items' });
      }
      if (!resolved.ok) return reply.status(400).send({ error: resolved.error });

      const { data: workspace, error: workspaceError } = await supabase
        .from('workspace_sharing_settings')
        .select('public_share_template')
        .eq('tenant_id', tenantId)
        .single();
      if (workspaceError) {
        request.log.error(workspaceError);
        return reply.status(500).send({ error: 'Could not load the sharing template' });
      }
      const template = workspace?.public_share_template ?? '';

      const blocks = resolved.items.map((item) => {
        const f = item.fields;
        const mergeFields: Record<string, string> = {
          title: f.title,
          type: f.type,
          address: f.address,
          city: f.city,
          province: f.province,
          price: f.price != null ? f.price.toLocaleString() : '',
          price_currency: f.price_currency,
          bedrooms: f.bedrooms?.toString() ?? '',
          bathrooms: f.bathrooms?.toString() ?? '',
          floor_area_sqm: f.floor_area_sqm?.toString() ?? '',
          lot_area_sqm: f.lot_area_sqm?.toString() ?? '',
          parking_slots: f.parking_slots?.toString() ?? '',
        };
        return mergeTemplate(template, mergeFields);
      });

      return { text: blocks.join('\n\n') };
    },
  );

  // 4. Generate itinerary -- residoro's first external third-party API
  // integration. Creates a real Google Doc via the Docs/Drive API under the
  // one shared Residoro service account (see lib/googleDocs.ts), shares it
  // with the requesting agent, returns a working link. No silent failure:
  // an unconfigured or failing Google call is always a clear 4xx/5xx with a
  // message, never a quiet no-op.
  app.post<{ Params: { id: string }; Body: ItemsBody }>(
    '/buyer-requirements/:id/itinerary',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!isGoogleDocsConfigured()) {
        return reply.status(501).send({
          error:
            'Itinerary generation is not configured yet. GOOGLE_APPLICATION_CREDENTIALS is not set on the backend (see lib/googleDocs.ts).',
        });
      }

      const supabase = getScopedClient(request);
      const tenantId = request.user!.tenantId;

      const lead = await loadLead(supabase, tenantId, request.params.id).catch((err) => {
        request.log.error(err);
        return undefined;
      });
      if (lead === undefined) return reply.status(500).send({ error: 'Could not load the lead' });
      if (!lead) return reply.status(404).send({ error: 'Lead not found in your workspace' });

      let resolved;
      try {
        resolved = await resolveAndValidateMatchItems(supabase, tenantId, request.user!.id, request.body?.items);
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Could not verify the matched items' });
      }
      if (!resolved.ok) return reply.status(400).send({ error: resolved.error });

      const buyerLabel = lead.contacts?.name ?? 'Buyer';
      const items: ItineraryItem[] = resolved.items.map((item) => ({
        label: item.fields.title,
        detail: itineraryDetailFor(item),
        sourceNote: sourceNoteFor(item),
      }));

      let documentId: string;
      let url: string;
      try {
        const doc = await createItineraryDoc({
          title: `Showing Itinerary — ${buyerLabel}`,
          buyerLabel,
          items,
        });
        documentId = doc.documentId;
        url = doc.url;
      } catch (err) {
        request.log.error(err);
        return reply.status(502).send({ error: (err as Error).message });
      }

      try {
        const { data: userData } = await supabaseAdmin.auth.admin.getUserById(request.user!.id);
        await shareItineraryDoc(documentId, userData.user?.email ?? null);
      } catch (err) {
        request.log.error(err);
        // Doc exists and is retrievable via `url` (created under the shared
        // service account) even if sharing failed -- surface the failure
        // rather than silently pretending it succeeded, but still return the
        // link, since it isn't lost, only not (yet) shared to the agent.
        return reply.status(502).send({
          error: `Itinerary doc created but could not be shared: ${(err as Error).message}`,
          document_id: documentId,
          url,
        });
      }

      return reply.status(201).send({ document_id: documentId, url });
    },
  );
}
