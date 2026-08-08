import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';

type NotificationRow = {
  id: string;
  tenant_id: string;
  recipient_id: string | null;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
};

// tb-notifications-task-due-reminder-001: TB1 of cap-notifications-001 --
// the general per-user notification inbox. Unlike contract_notifications
// (RLS-enabled-but-policy-less, service-role-only), this table has real RLS
// policies and is read through the scoped client, the current target
// architecture (tb-platform-rls-scoped-client-001) rather than that
// documented exception.
export async function registerNotificationsRoutes(app: FastifyInstance) {
  app.get('/notifications', { preHandler: requireAuth }, async (request, reply) => {
    const { data, error } = await getScopedClient(request)
      .from('notifications')
      .select('*')
      .eq('tenant_id', request.user!.tenantId)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .returns<NotificationRow[]>();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load notifications' });
    }
    return { notifications: data ?? [] };
  });

  app.post<{ Params: { id: string } }>(
    '/notifications/:id/dismiss',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { error } = await getScopedClient(request)
        .from('notifications')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId);

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not dismiss the notification' });
      }

      return { status: 'dismissed' };
    },
  );
}
