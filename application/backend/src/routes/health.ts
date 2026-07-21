import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

export async function registerHealthRoute(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    const { error } = await supabaseAdmin.from('workspaces').select('id').limit(1);

    if (error) {
      return reply.status(503).send({ status: 'error', supabase: 'unreachable', detail: error.message });
    }

    return { status: 'ok', supabase: 'reachable' };
  });
}
