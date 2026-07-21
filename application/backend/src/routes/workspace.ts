import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { activeWarningTier, daysUntil } from '../lib/contractExpiry.js';

// tb-client-lifecycle-contract-expiry-001: what the brokerage frontend polls
// to render the warning banner and side-panel notifications, and to decide
// whether write UI should render as disabled. access_state itself is
// authoritative and enforced server-side in requireAuth -- this route (and
// active_warning) is purely for display.
export async function registerWorkspaceRoutes(app: FastifyInstance) {
  app.get('/me/workspace-status', { preHandler: requireAuth }, async (request, reply) => {
    const { data: workspace, error } = await supabaseAdmin
      .from('workspaces')
      .select('access_state, contract_end_date')
      .eq('id', request.user!.tenantId)
      .single();

    if (error || !workspace) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load workspace status' });
    }

    const { data: notifications, error: notificationsError } = await supabaseAdmin
      .from('contract_notifications')
      .select('id, threshold, message, created_at')
      .eq('tenant_id', request.user!.tenantId)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false });

    if (notificationsError) {
      request.log.error(notificationsError);
      return reply.status(500).send({ error: 'Could not load notifications' });
    }

    const days = daysUntil(workspace.contract_end_date);

    return {
      access_state: workspace.access_state,
      contract_end_date: workspace.contract_end_date,
      active_warning: workspace.access_state === 'active' ? activeWarningTier(days) : null,
      notifications: notifications ?? [],
    };
  });

  app.post<{ Params: { id: string } }>(
    '/me/notifications/:id/dismiss',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { error } = await supabaseAdmin
        .from('contract_notifications')
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
