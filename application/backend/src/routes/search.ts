import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';

type GlobalSearchResult = {
  entity_type:
    | 'property'
    | 'listing'
    | 'contact'
    | 'lead'
    | 'inquiry'
    | 'task'
    | 'project'
    | 'viewing'
    | 'offer'
    | 'contract'
    | 'closing';
  entity_id: string;
  title: string;
  subtitle: string | null;
  rank: number;
};

// tb-search-core-entities-001: named /global-search, not /search, since
// POST /search already exists (cap-buyer-leads-001's requirement-matching
// search) -- unrelated concept, same word.
export async function registerSearchRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string } }>('/global-search', { preHandler: requireAuth }, async (request, reply) => {
    const q = request.query.q?.trim();
    if (!q) return { results: [] };

    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .rpc('search_global', { p_query: q })
      .returns<GlobalSearchResult[]>();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Search failed' });
    }
    return { results: data ?? [] };
  });
}
