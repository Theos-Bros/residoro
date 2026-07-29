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

type TrainingScheduleBody = {
  session_1_date?: string;
  session_2_date?: string;
};

type TrainingStatusBody = {
  status?: string;
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

    // 2026-07-29 security review: tenant_id must never travel through
    // inviteUserByEmail's `data` option -- that maps to raw_user_meta_data,
    // the same field Supabase Auth's public POST /auth/v1/signup lets ANY
    // caller set, which is exactly how a workspace hijack was possible.
    // handle_new_user() now always creates an inert profile; the real
    // assignment happens here, immediately after, keyed by the invite
    // response's own trusted user id.
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(admin_email, {
      redirectTo: `${frontendUrl}/accept-invite`,
    });

    if (inviteError || !inviteData.user) {
      // Don't leave an orphaned, admin-less workspace behind.
      await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
      request.log.error(inviteError);
      return reply.status(502).send({ error: `Could not send the invite: ${inviteError?.message ?? 'unknown error'}` });
    }

    const { error: assignError } = await supabaseAdmin
      .from('profiles')
      .update({ tenant_id: workspace.id, role: 'admin' })
      .eq('id', inviteData.user.id);

    if (assignError) {
      await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
      request.log.error(assignError);
      return reply.status(500).send({ error: 'Could not assign the invited admin to the workspace' });
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
      .select('id, name, contract_start_date, contract_end_date, access_state, exclusivity_hard_block, rollback_window_hours')
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
        exclusivity_hard_block: w.exclusivity_hard_block,
        rollback_window_hours: w.rollback_window_hours,
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

  // tb-listings-exclusivity-hardblock-001: an operator-only per-workspace
  // toggle. tb-listings-authority-001's soft warning stays the default for
  // every workspace (the migration's column default is false); this route
  // is the only way it ever becomes true. A dedicated sub-route rather than
  // folding into PATCH /admin/clients/:id above, since that handler's
  // body/response shape is already specific to contract_end_date -- same
  // precedent as /admin/clients/:id/training below having its own route.
  app.patch<{ Params: { id: string }; Body: { exclusivity_hard_block?: boolean } }>(
    '/admin/clients/:id/listings-policy',
    { preHandler: requireOperator },
    async (request, reply) => {
      const { exclusivity_hard_block } = request.body ?? {};

      if (typeof exclusivity_hard_block !== 'boolean') {
        return reply.status(400).send({ error: 'exclusivity_hard_block must be a boolean' });
      }

      const { data, error } = await supabaseAdmin
        .from('workspaces')
        .update({ exclusivity_hard_block })
        .eq('id', request.params.id)
        .select('id, exclusivity_hard_block')
        .single();

      if (error || !data) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update the listings policy' });
      }

      return { workspace_id: data.id, exclusivity_hard_block: data.exclusivity_hard_block };
    },
  );

  // tb-migration-rollback-window-001: an operator-only per-workspace
  // rollback window override, read by migrations.ts at import-batch-creation
  // time only -- changing this does not retroactively affect a batch's
  // already-stored rollback_deadline. Default (24, the migration's column
  // default) preserves tb-migration-rollback-001's existing fixed-24h
  // behavior for every workspace unless an operator explicitly sets a
  // different value. Same dedicated-sub-route precedent as
  // /admin/clients/:id/listings-policy above.
  app.patch<{ Params: { id: string }; Body: { rollback_window_hours?: number } }>(
    '/admin/clients/:id/rollback-policy',
    { preHandler: requireOperator },
    async (request, reply) => {
      const { rollback_window_hours } = request.body ?? {};

      if (
        typeof rollback_window_hours !== 'number' ||
        !Number.isInteger(rollback_window_hours) ||
        rollback_window_hours <= 0
      ) {
        return reply.status(400).send({ error: 'rollback_window_hours must be a positive integer' });
      }

      const { data, error } = await supabaseAdmin
        .from('workspaces')
        .update({ rollback_window_hours })
        .eq('id', request.params.id)
        .select('id, rollback_window_hours')
        .single();

      if (error || !data) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update the rollback policy' });
      }

      return { workspace_id: data.id, rollback_window_hours: data.rollback_window_hours };
    },
  );

  // tb-client-lifecycle-training-001: record/reschedule a client's two
  // training session dates. Upserts both rows in one call rather than two
  // separate endpoints, since the doc's acceptance criteria treats "record
  // both dates" as one operator action. reminder_sent_at resets to null on
  // every call (including a no-op resubmission) so a rescheduled session is
  // always eligible for a fresh reminder -- mirrors contract-expiry's
  // renewal-clears-warning-flags behavior.
  app.post<{ Params: { id: string }; Body: TrainingScheduleBody }>(
    '/admin/clients/:id/training',
    { preHandler: requireOperator },
    async (request, reply) => {
      const { session_1_date, session_2_date } = request.body ?? {};

      if (!session_1_date || !session_2_date) {
        return reply.status(400).send({ error: 'session_1_date and session_2_date are required' });
      }
      if (Number.isNaN(new Date(session_1_date).getTime()) || Number.isNaN(new Date(session_2_date).getTime())) {
        return reply.status(400).send({ error: 'session_1_date and session_2_date must be valid dates' });
      }

      const { data, error } = await supabaseAdmin
        .from('training_sessions')
        .upsert(
          [
            { workspace_id: request.params.id, session_number: 1, scheduled_date: session_1_date, reminder_sent_at: null },
            { workspace_id: request.params.id, session_number: 2, scheduled_date: session_2_date, reminder_sent_at: null },
          ],
          { onConflict: 'workspace_id,session_number' },
        )
        .select('id, session_number, scheduled_date, status');

      if (error || !data) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not save training sessions' });
      }

      return { workspace_id: request.params.id, sessions: data };
    },
  );

  // tb-client-lifecycle-training-001: mark a session completed or missed.
  app.patch<{ Params: { id: string }; Body: TrainingStatusBody }>(
    '/admin/training/:id',
    { preHandler: requireOperator },
    async (request, reply) => {
      const { status } = request.body ?? {};

      if (status !== 'completed' && status !== 'missed') {
        return reply.status(400).send({ error: "status must be 'completed' or 'missed'" });
      }

      const { data, error } = await supabaseAdmin
        .from('training_sessions')
        .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null })
        .eq('id', request.params.id)
        .select('id, status, completed_at')
        .single();

      if (error || !data) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update training session status' });
      }

      return data;
    },
  );

  // tb-client-lifecycle-training-001: cross-client training overview.
  // status=upcoming|overdue filters; omitted returns every session so the
  // frontend can render a single table with an overdue badge inline.
  app.get<{ Querystring: { status?: string } }>('/admin/training', { preHandler: requireOperator }, async (request, reply) => {
    const { data, error } = await supabaseAdmin
      .from('training_sessions')
      .select('id, workspace_id, session_number, scheduled_date, status, completed_at, workspaces(name)')
      .order('scheduled_date', { ascending: true });

    if (error || !data) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load training sessions' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const sessions = (data as unknown as Array<{
      id: string;
      workspace_id: string;
      session_number: number;
      scheduled_date: string;
      status: string;
      completed_at: string | null;
      workspaces: { name: string } | null;
    }>).map((s) => ({
      id: s.id,
      workspace_id: s.workspace_id,
      brokerage_name: s.workspaces?.name ?? '',
      session_number: s.session_number,
      scheduled_date: s.scheduled_date,
      status: s.status,
      completed_at: s.completed_at,
      overdue: s.status === 'scheduled' && s.scheduled_date < today,
    }));

    const { status } = request.query ?? {};
    const filtered =
      status === 'upcoming'
        ? sessions.filter((s) => s.status === 'scheduled' && !s.overdue)
        : status === 'overdue'
          ? sessions.filter((s) => s.overdue)
          : sessions;

    return { sessions: filtered };
  });
}
