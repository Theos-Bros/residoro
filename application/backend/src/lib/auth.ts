import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabaseAdmin } from './supabaseAdmin.js';

export type AuthedUser = {
  id: string;
  tenantId: string;
  role: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

// First authenticated backend route establishes this pattern: tenant is always
// derived server-side from the verified auth token, never trusted from the
// request body (see tb-migration-csv-001 plan's Deviations section).
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

  if (!token) {
    return reply.status(401).send({ error: 'Missing bearer token' });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('tenant_id, role')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile?.tenant_id) {
    return reply.status(401).send({ error: 'No workspace found for this user' });
  }

  request.user = { id: userData.user.id, tenantId: profile.tenant_id, role: profile.role };
}
