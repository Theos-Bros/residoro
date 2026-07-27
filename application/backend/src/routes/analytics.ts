import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { canEditSetting } from '../lib/settingsDelegation.js';

type Audience = 'public' | 'co_broker' | 'internal';
const AUDIENCES: Audience[] = ['public', 'co_broker', 'internal'];
const HOT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type ShareEventBody = {
  audience?: string;
};

type PerformanceSettingsBody = {
  hot_share_threshold?: number;
};

// supabase-js has no group-by/count aggregate -- this mirrors listings.ts's
// coverPhotoUrlsByProperty helper: one query, reduced into a Map client-side,
// rather than one query per listing.
async function shareCountsByListing(supabase: SupabaseClient, tenantId: string): Promise<Map<string, number>> {
  const cutoff = new Date(Date.now() - HOT_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('listing_share_events')
    .select('listing_id')
    .eq('tenant_id', tenantId)
    .gte('created_at', cutoff);

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ listing_id: string }>) {
    counts.set(row.listing_id, (counts.get(row.listing_id) ?? 0) + 1);
  }
  return counts;
}

// tb-analytics-share-performance-001: cap-analytics-001's first tracer
// bullet. Best-effort telemetry, not an audit trail -- see the tracer
// bullet's Context for why POST /listings/:id/share-events can always be
// bypassed by a manual select+copy, and why that's an accepted limitation
// rather than something this route attempts to close.
export async function registerAnalyticsRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: ShareEventBody }>(
    '/listings/:id/share-events',
    { preHandler: requireAuth },
    async (request, reply) => {
      const audience = request.body?.audience as Audience | undefined;
      if (!audience || !AUDIENCES.includes(audience)) {
        return reply.status(400).send({ error: `audience must be one of: ${AUDIENCES.join(', ')}` });
      }

      const supabase = getScopedClient(request);
      const { data: listing, error: listingError } = await supabase
        .from('listings')
        .select('id')
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle();

      if (listingError) {
        request.log.error(listingError);
        return reply.status(500).send({ error: 'Could not verify the listing' });
      }
      if (!listing) {
        return reply.status(404).send({ error: 'Listing not found in your workspace' });
      }

      const { data, error } = await supabase
        .from('listing_share_events')
        .insert({
          listing_id: request.params.id,
          tenant_id: request.user!.tenantId,
          audience,
          shared_by: request.user!.id,
        })
        .select('id')
        .single();

      if (error || !data) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not log the share event' });
      }

      return reply.status(201).send(data);
    },
  );

  app.get('/listings/performance', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);

    const { data: workspace, error: workspaceError } = await supabase
      .from('workspace_performance_settings')
      .select('hot_share_threshold')
      .eq('tenant_id', request.user!.tenantId)
      .single();

    if (workspaceError || !workspace) {
      request.log.error(workspaceError);
      return reply.status(500).send({ error: 'Could not load workspace settings' });
    }

    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id, properties(title)')
      .eq('tenant_id', request.user!.tenantId);

    if (listingsError) {
      request.log.error(listingsError);
      return reply.status(500).send({ error: 'Could not load listings' });
    }

    let counts: Map<string, number>;
    try {
      counts = await shareCountsByListing(supabase, request.user!.tenantId);
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: 'Could not load share counts' });
    }

    const rows = (listings as unknown as Array<{ id: string; properties: { title: string } | null }>)
      .map((listing) => {
        const share_count_30d = counts.get(listing.id) ?? 0;
        return {
          listing_id: listing.id,
          title: listing.properties?.title ?? '',
          share_count_30d,
          hot: share_count_30d >= workspace.hot_share_threshold,
        };
      })
      .sort((a, b) => b.share_count_30d - a.share_count_30d);

    return { listings: rows };
  });

  app.get('/settings/performance', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('workspace_performance_settings')
      .select('hot_share_threshold')
      .eq('tenant_id', request.user!.tenantId)
      .single();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load performance settings' });
    }

    const can_edit = await canEditSetting(supabase, request.user!.tenantId, request.user!.id, request.user!.role, 'performance');
    return { ...data, can_edit };
  });

  // tb-brokerage-permissions-delegation-001: role === 'admin' OR an explicit
  // delegation grant. The write goes through the caller's own scoped client
  // -- workspace_performance_settings' own RLS policy (has_settings_delegation,
  // see the migration) is the real enforcement here, not this check alone.
  // This app-level check only exists to return a clean 403, same precedent
  // as PATCH /settings/share-templates. Never trust the GET's can_edit alone.
  app.patch<{ Body: PerformanceSettingsBody }>(
    '/settings/performance',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const canEdit = await canEditSetting(
        supabase,
        request.user!.tenantId,
        request.user!.id,
        request.user!.role,
        'performance',
      );
      if (!canEdit) {
        return reply.status(403).send({ error: 'Only an admin or a delegated member can edit performance settings' });
      }

      const { hot_share_threshold } = request.body ?? {};
      if (typeof hot_share_threshold !== 'number' || !Number.isInteger(hot_share_threshold) || hot_share_threshold < 1) {
        return reply.status(400).send({ error: 'hot_share_threshold must be a positive integer' });
      }

      const { data, error } = await supabase
        .from('workspace_performance_settings')
        .update({ hot_share_threshold })
        .eq('tenant_id', request.user!.tenantId)
        .select('hot_share_threshold')
        .single();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not save performance settings' });
      }
      return { ...data, can_edit: true };
    },
  );
}
