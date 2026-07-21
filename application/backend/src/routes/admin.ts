import type { FastifyInstance } from 'fastify';
import { requireOperator } from '../lib/auth.js';

export async function registerAdminRoutes(app: FastifyInstance) {
  // Smallest end-to-end proof of the operator auth path: token -> profile
  // lookup -> operator check -> response. The frontend calls this right
  // after sign-in to decide whether to route to /admin.
  app.get('/admin/whoami', { preHandler: requireOperator }, async (request) => {
    return { id: request.operator!.id, role: request.operator!.role };
  });
}
