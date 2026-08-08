import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { validateEmail } from '../lib/emailValidation.js';

type InviteMemberBody = {
  email?: string;
  full_name?: string;
};

type ProfileRow = { id: string; full_name: string | null; handle: string | null; role: string; created_at: string };

// tb-client-lifecycle-member-invite-001: lets a workspace's own admin grow
// their team without operator involvement -- the gap left by
// tb-client-lifecycle-enrollment-001 only ever creating the first (admin)
// user. Every invite here is role: member -- profiles_one_admin_per_tenant
// (tb-brokerage-permissions-admin-uniqueness-001) already makes
// admin-inviting-admin impossible at the DB level, so this never has to
// branch on role.
export async function registerMembersRoutes(app: FastifyInstance) {
  // Same tenant-scoped, RLS-authenticated read GET /settings/permissions
  // already uses for its own member list -- profiles_select_same_tenant
  // already lets any tenant member read this, but the route itself is
  // admin-only per this tracer bullet's decision (who's-on-the-team is an
  // admin-management concern, mirroring settings/permissions' own precedent).
  app.get('/workspace/members', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user!.role !== 'admin') {
      return reply.status(403).send({ error: 'Only an admin can view the team list' });
    }

    const { data, error } = await getScopedClient(request)
      .from('profiles')
      .select('id, full_name, handle, role, created_at')
      .eq('tenant_id', request.user!.tenantId)
      .order('created_at', { ascending: true })
      .returns<ProfileRow[]>();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load the team list' });
    }

    return { members: data ?? [] };
  });

  app.post<{ Body: InviteMemberBody }>('/workspace/members', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user!.role !== 'admin') {
      return reply.status(403).send({ error: 'Only an admin can invite a team member' });
    }

    const { email, full_name } = request.body ?? {};
    if (!email) {
      return reply.status(400).send({ error: 'A valid email is required' });
    }
    const emailCheck = validateEmail(email);
    if (!emailCheck.ok) {
      return reply.status(400).send({
        error: emailCheck.reason === 'disposable_domain'
          ? 'Disposable/temporary email addresses are not allowed'
          : 'A valid email is required',
      });
    }

    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) {
      request.log.error('FRONTEND_URL is not set');
      return reply.status(500).send({ error: 'Server is misconfigured' });
    }

    // 2026-07-29 security review: tenant_id/role must never travel through
    // inviteUserByEmail's `data` option -- see admin.ts's POST /admin/clients
    // for the full rationale. This route follows the identical pattern:
    // invite with no metadata, then a trusted service-role UPDATE keyed by
    // the invite response's (or the pre-existing user's) own id.
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: full_name ? { full_name } : undefined,
      redirectTo: `${frontendUrl}/accept-invite`,
    });

    let targetUserId: string;
    let status: 'invited' | 'added';

    if (inviteError || !inviteData.user) {
      // Supabase Auth's public signup endpoint is still enabled as of this
      // writing (security review Finding 1's recommended Dashboard toggle
      // isn't flipped yet) -- so this email may already have an inert
      // (tenant_id: null) auth.users/profiles row from an unrelated prior
      // signup. inviteUserByEmail errors on any email that already has an
      // account; that's expected here, not a real failure, unless the
      // lookup below can't find/claim the account either.
      const { data: existingList, error: listError } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = listError
        ? undefined
        : existingList.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

      if (!existingUser) {
        request.log.error(inviteError);
        return reply.status(502).send({ error: `Could not invite this email: ${inviteError?.message ?? 'unknown error'}` });
      }

      const { data: existingProfile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('tenant_id')
        .eq('id', existingUser.id)
        .single<{ tenant_id: string | null }>();

      if (profileError || !existingProfile) {
        request.log.error(profileError);
        return reply.status(500).send({ error: 'Could not look up this email’s existing account' });
      }
      if (existingProfile.tenant_id !== null) {
        return reply.status(409).send({ error: 'This email already belongs to a workspace' });
      }

      targetUserId = existingUser.id;
      status = 'added';
    } else {
      targetUserId = inviteData.user.id;
      status = 'invited';
    }

    const { error: assignError } = await supabaseAdmin
      .from('profiles')
      .update({ tenant_id: request.user!.tenantId, role: 'member' })
      .eq('id', targetUserId);

    if (assignError) {
      request.log.error(assignError);
      return reply.status(500).send({ error: 'Could not add this member to your workspace' });
    }

    return { id: targetUserId, email, status };
  });

  app.delete<{ Params: { id: string } }>('/workspace/members/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user!.role !== 'admin') {
      return reply.status(403).send({ error: 'Only an admin can remove a team member' });
    }

    // Never trust :id alone -- confirm the target is a real profile in the
    // caller's own tenant before touching anything (same IDOR-prevention
    // pattern as settingsPermissions.ts's PUT).
    const { data: target, error: targetError } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', request.params.id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle<{ id: string; role: string }>();

    if (targetError) {
      request.log.error(targetError);
      return reply.status(500).send({ error: 'Could not verify the target member' });
    }
    if (!target) {
      return reply.status(404).send({ error: 'Member not found in your workspace' });
    }
    if (target.role === 'admin') {
      return reply.status(400).send({ error: 'Cannot remove the workspace admin' });
    }

    // Deletes the profiles row first (explicit, not relying on an assumed
    // ON DELETE CASCADE from auth.users), then the auth account itself --
    // removal is a hard delete for this tracer bullet's v1, not a
    // reversible deactivation.
    const { error: profileDeleteError } = await supabaseAdmin.from('profiles').delete().eq('id', target.id);
    if (profileDeleteError) {
      request.log.error(profileDeleteError);
      return reply.status(500).send({ error: 'Could not remove this member' });
    }

    const { error: userDeleteError } = await supabaseAdmin.auth.admin.deleteUser(target.id);
    if (userDeleteError) {
      request.log.error(userDeleteError);
      return reply.status(500).send({ error: 'Removed from the workspace, but could not fully delete the account' });
    }

    return { status: 'removed' };
  });
}
