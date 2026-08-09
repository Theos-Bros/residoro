import type { FastifyInstance } from 'fastify';
import { requireAnyIdentity, getScopedClient } from '../lib/auth.js';

type ProfileRow = { full_name: string | null; prefix: string | null };
type ProfilePatchBody = { full_name?: string; prefix?: string | null };

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
// queried or written here. prefix follows full_name's exact grant/RLS shape
// (see 20260810140000_profiles_prefix.sql), so no new access-control code is
// needed for it beyond including it in the select/update column lists.
export async function registerProfileRoutes(app: FastifyInstance) {
  app.get('/me/profile', { preHandler: requireAnyIdentity }, async (request, reply) => {
    const { data, error } = await getScopedClient(request)
      .from('profiles')
      .select('full_name, prefix')
      .eq('id', request.identity!.id)
      .single<ProfileRow>();

    if (error || !data) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load your profile' });
    }

    return { full_name: data.full_name, prefix: data.prefix, email: request.identity!.email };
  });

  app.patch<{ Body: ProfilePatchBody }>(
    '/me/profile',
    { preHandler: requireAnyIdentity },
    async (request, reply) => {
      const { full_name: fullName, prefix } = request.body ?? {};
      if (typeof fullName !== 'string' || fullName.trim() === '') {
        return reply.status(400).send({ error: 'full_name is required' });
      }

      const { data, error } = await getScopedClient(request)
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          // Partial-update semantics: omitting `prefix` entirely leaves the
          // stored value unchanged; an empty string clears it to null.
          ...(prefix !== undefined && { prefix: prefix?.trim() || null }),
        })
        .eq('id', request.identity!.id)
        .select('full_name, prefix')
        .single<ProfileRow>();

      if (error || !data) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update your profile' });
      }

      return { full_name: data.full_name, prefix: data.prefix, email: request.identity!.email };
    },
  );
}
