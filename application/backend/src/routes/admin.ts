import type { FastifyInstance } from 'fastify';
import { requireOperator } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type NewClientBody = {
  brokerage_name?: string;
  admin_email?: string;
  contract_start_date?: string;
  contract_end_date?: string;
};

export async function registerAdminRoutes(app: FastifyInstance) {
  // Smallest end-to-end proof of the operator auth path: token -> profile
  // lookup -> operator check -> response. The frontend calls this right
  // after sign-in to decide whether to route to /admin.
  app.get('/admin/whoami', { preHandler: requireOperator }, async (request) => {
    return { id: request.operator!.id, role: request.operator!.role };
  });

  // tb-client-lifecycle-enrollment-001: replaces manual Supabase Studio
  // enrollment. Creates the workspace, then invites its first (admin) user
  // into it via the 'tenant_id' invite-metadata branch that
  // 20260722110000_client_enrollment.sql added to handle_new_user() -- the
  // same trust argument as the operator branch applies here: only this
  // service-role route ever sets tenant_id in invite metadata.
  app.post<{ Body: NewClientBody }>('/admin/clients', { preHandler: requireOperator }, async (request, reply) => {
    const { brokerage_name, admin_email, contract_start_date, contract_end_date } = request.body ?? {};

    if (!brokerage_name || !admin_email || !contract_start_date || !contract_end_date) {
      return reply.status(400).send({
        error: 'brokerage_name, admin_email, contract_start_date, and contract_end_date are required',
      });
    }
    if (!EMAIL_RE.test(admin_email)) {
      return reply.status(400).send({ error: 'admin_email is not a valid email address' });
    }

    const start = new Date(contract_start_date);
    const end = new Date(contract_end_date);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return reply.status(400).send({ error: 'contract_start_date and contract_end_date must be valid dates' });
    }
    if (end <= start) {
      return reply.status(400).send({ error: 'contract_end_date must be after contract_start_date' });
    }

    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) {
      request.log.error('FRONTEND_URL is not set');
      return reply.status(500).send({ error: 'Server is misconfigured' });
    }

    const { data: workspace, error: workspaceError } = await supabaseAdmin
      .from('workspaces')
      .insert({ name: brokerage_name, contract_start_date, contract_end_date })
      .select('id')
      .single();

    if (workspaceError || !workspace) {
      request.log.error(workspaceError);
      return reply.status(500).send({ error: 'Could not create the workspace' });
    }

    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(admin_email, {
      data: { tenant_id: workspace.id },
      redirectTo: `${frontendUrl}/accept-invite`,
    });

    if (inviteError) {
      // Don't leave an orphaned, admin-less workspace behind.
      await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
      request.log.error(inviteError);
      return reply.status(502).send({ error: `Could not send the invite: ${inviteError.message}` });
    }

    return { workspace_id: workspace.id, status: 'created', invite_status: 'pending' };
  });

  // Client list for the admin dashboard -- brokerage name, contract dates,
  // and whether the invited admin has accepted (set a password) yet. Every
  // workspace here has exactly one 'admin' profile, created synchronously by
  // handle_new_user() when POST /admin/clients' invite call ran (a failed
  // invite deletes the workspace above rather than leaving it admin-less).
  app.get('/admin/clients', { preHandler: requireOperator }, async (request, reply) => {
    const { data: workspaces, error: workspacesError } = await supabaseAdmin
      .from('workspaces')
      .select('id, name, contract_start_date, contract_end_date, access_state')
      .order('created_at', { ascending: false });

    if (workspacesError || !workspaces) {
      request.log.error(workspacesError);
      return reply.status(500).send({ error: 'Could not load clients' });
    }
    if (workspaces.length === 0) {
      return { clients: [] };
    }

    const { data: admins, error: adminsError } = await supabaseAdmin
      .from('profiles')
      .select('id, tenant_id')
      .eq('role', 'admin')
      .in(
        'tenant_id',
        workspaces.map((w) => w.id),
      );

    if (adminsError) {
      request.log.error(adminsError);
      return reply.status(500).send({ error: 'Could not load client invite status' });
    }

    const adminIdByTenant = new Map((admins ?? []).map((a) => [a.tenant_id as string, a.id as string]));
    const confirmedByTenant = new Map<string, boolean>();

    await Promise.all(
      Array.from(adminIdByTenant.entries()).map(async ([tenantId, adminId]) => {
        const { data } = await supabaseAdmin.auth.admin.getUserById(adminId);
        confirmedByTenant.set(tenantId, Boolean(data.user?.email_confirmed_at));
      }),
    );

    return {
      clients: workspaces.map((w) => ({
        workspace_id: w.id,
        brokerage_name: w.name,
        contract_start_date: w.contract_start_date,
        contract_end_date: w.contract_end_date,
        access_state: w.access_state,
        invite_status: confirmedByTenant.get(w.id) ? 'accepted' : 'pending',
      })),
    };
  });

  // tb-client-lifecycle-contract-expiry-001's renewal path: the doc
  // deliberately doesn't assume a dedicated renewal screen beyond "extend
  // contract_end_date somewhere" -- this is that somewhere. The next daily
  // contract-expiry-check run (Edge Function) is what actually resets
  // access_state back to 'active' and clears warning flags; this endpoint
  // only records the new date.
  app.patch<{ Params: { id: string }; Body: { contract_end_date?: string } }>(
    '/admin/clients/:id',
    { preHandler: requireOperator },
    async (request, reply) => {
      const { contract_end_date } = request.body ?? {};

      if (!contract_end_date || Number.isNaN(new Date(contract_end_date).getTime())) {
        return reply.status(400).send({ error: 'contract_end_date is required and must be a valid date' });
      }

      const { data, error } = await supabaseAdmin
        .from('workspaces')
        .update({ contract_end_date })
        .eq('id', request.params.id)
        .select('id, contract_end_date')
        .single();

      if (error || !data) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update the contract end date' });
      }

      return { workspace_id: data.id, contract_end_date: data.contract_end_date };
    },
  );
}
