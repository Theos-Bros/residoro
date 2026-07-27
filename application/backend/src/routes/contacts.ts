import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';

// tb-properties-owner-linking-001: contacts previously had no brokerage-
// facing read route -- only written via Migration's CSV import
// (tb-migration-contacts-001) and read via the operator-facing export
// (export.ts). This is the first route that lets an agent/admin browse
// contacts directly, for the property-creation owner picker.
export async function registerContactsRoutes(app: FastifyInstance) {
  app.get('/contacts', { preHandler: requireAuth }, async (request, reply) => {
    const { data, error } = await getScopedClient(request)
      .from('contacts')
      .select('id, name, type, company')
      .eq('tenant_id', request.user!.tenantId)
      .order('name', { ascending: true });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load contacts' });
    }

    return { contacts: data ?? [] };
  });
}
