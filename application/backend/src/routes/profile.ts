import type { FastifyInstance } from 'fastify';
import { requireAnyIdentity, getScopedClient } from '../lib/auth.js';

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  prefix: string | null;
  position: string | null;
};
type ProfilePatchBody = { first_name?: string; last_name?: string | null; prefix?: string | null };

// tb-user-profile-display-name-001: the smallest slice of cap-user-profile-001
// -- full_name only, self-scoped, shared by both tenant users and operators
// via requireAnyIdentity. getScopedClient (not supabaseAdmin) for both reads
// and writes, per ADR-003's preference for RLS-scoped over service-role
// access on user-facing routes -- profiles_select_own and profiles_update_own
// (20260806110000_profiles_self_select.sql) both key on `id = auth.uid()`
// alone, with no tenant_id involved, so they already work identically for a
// tenant user and a tenant-less operator.
//
// tb-user-profile-email-prefix-001: email is never a profiles column -- it's
// read off the already-verified Auth token (request.identity!.email), never
// queried or written here. prefix follows full_name's exact grant/RLS shape.
//
// tb-user-profile-name-split-001: full_name replaced by first_name/last_name
// (20260810150000_profiles_name_split.sql). first_name is required (same
// validation shape full_name had); last_name and prefix are both optional
// with partial-update semantics (an omitted key leaves the stored value
// unchanged, an empty string clears it to null).
//
// tb-employee-position-001: position is read-only here, deliberately not in
// ProfilePatchBody -- it has no client-facing update grant at all (see
// 20260810160000_profiles_position.sql), admin-set only via
// PATCH /workspace/members/:id/position in members.ts.
export async function registerProfileRoutes(app: FastifyInstance) {
  app.get('/me/profile', { preHandler: requireAnyIdentity }, async (request, reply) => {
    const { data, error } = await getScopedClient(request)
      .from('profiles')
      .select('first_name, last_name, prefix, position')
      .eq('id', request.identity!.id)
      .single<ProfileRow>();

    if (error || !data) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load your profile' });
    }

    return {
      first_name: data.first_name,
      last_name: data.last_name,
      prefix: data.prefix,
      position: data.position,
      email: request.identity!.email,
    };
  });

  app.patch<{ Body: ProfilePatchBody }>(
    '/me/profile',
    { preHandler: requireAnyIdentity },
    async (request, reply) => {
      const { first_name: firstName, last_name: lastName, prefix } = request.body ?? {};
      if (typeof firstName !== 'string' || firstName.trim() === '') {
        return reply.status(400).send({ error: 'first_name is required' });
      }

      const { data, error } = await getScopedClient(request)
        .from('profiles')
        .update({
          first_name: firstName.trim(),
          ...(lastName !== undefined && { last_name: lastName?.trim() || null }),
          ...(prefix !== undefined && { prefix: prefix?.trim() || null }),
        })
        .eq('id', request.identity!.id)
        .select('first_name, last_name, prefix, position')
        .single<ProfileRow>();

      if (error || !data) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update your profile' });
      }

      return {
        first_name: data.first_name,
        last_name: data.last_name,
        prefix: data.prefix,
        position: data.position,
        email: request.identity!.email,
      };
    },
  );
}
