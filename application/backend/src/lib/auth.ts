import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabaseAdmin } from './supabaseAdmin.js';

export type AccessState = 'active' | 'read_only' | 'blocked';

export type AuthedUser = {
  id: string;
  tenantId: string;
  role: string;
  accessState: AccessState;
};

export type AuthedOperator = {
  id: string;
  role: 'operator';
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
    operator?: AuthedOperator;
  }
}

type VerifiedProfile = {
  userId: string;
  tenantId: string | null;
  role: string;
  accessState: AccessState | null;
};

// Shared by requireAuth and requireOperator: verify the bearer token against
// Supabase Auth, then look up the caller's profile (with its workspace's
// access_state embedded via the tenant_id FK -- null for operators, who
// aren't tenant-scoped). Replies and returns undefined on any failure so
// callers can just check the return value.
async function verifyBearerAndFetchProfile(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<VerifiedProfile | undefined> {
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

  if (!token) {
    reply.status(401).send({ error: 'Missing bearer token' });
    return undefined;
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    reply.status(401).send({ error: 'Invalid or expired token' });
    return undefined;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('tenant_id, role, workspaces(access_state)')
    .eq('id', userData.user.id)
    .single<{ tenant_id: string | null; role: string; workspaces: { access_state: AccessState } | null }>();

  if (profileError || !profile) {
    if (profileError) request.log.error(profileError);
    reply.status(401).send({ error: 'No profile found for this user' });
    return undefined;
  }

  return {
    userId: userData.user.id,
    tenantId: profile.tenant_id,
    role: profile.role,
    accessState: profile.workspaces?.access_state ?? null,
  };
}

// First authenticated backend route establishes this pattern: tenant is always
// derived server-side from the verified auth token, never trusted from the
// request body (see tb-migration-csv-001 plan's Deviations section).
//
// tb-client-lifecycle-contract-expiry-001: also enforces workspace
// access_state here, since every tenant-scoped route already goes through
// this guard -- 'blocked' rejects the request outright (this is what makes
// "login itself rejected" real, since there's no separate login endpoint to
// gate); 'read_only' allows GET (reads/export) but rejects any other method.
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const profile = await verifyBearerAndFetchProfile(request, reply);
  if (!profile) return;

  if (!profile.tenantId) {
    reply.status(401).send({ error: 'No workspace found for this user' });
    return;
  }

  const accessState = profile.accessState ?? 'active';

  if (accessState === 'blocked') {
    reply.status(403).send({
      error: 'Your workspace\'s contract has expired and access is blocked. Contact your Residoro representative to renew.',
      access_state: accessState,
    });
    return;
  }

  if (accessState === 'read_only' && request.method !== 'GET') {
    reply.status(403).send({
      error: 'Your workspace is in a read-only grace period after contract expiry. Contact your Residoro representative to renew.',
      access_state: accessState,
    });
    return;
  }

  request.user = { id: profile.userId, tenantId: profile.tenantId, role: profile.role, accessState };
}

// Operators are not tenant-scoped (tenant_id is null by design -- see
// tb-client-lifecycle-operator-access-001) -- this guard checks role instead
// of tenant_id, and never grants implicit cross-tenant access on its own:
// every route using this must scope its own queries explicitly, mirroring the
// service-role-only pattern already established for migration_temp_files.
export async function requireOperator(request: FastifyRequest, reply: FastifyReply) {
  const profile = await verifyBearerAndFetchProfile(request, reply);
  if (!profile) return;

  if (profile.role !== 'operator') {
    reply.status(403).send({ error: 'Operator access required' });
    return;
  }

  request.operator = { id: profile.userId, role: 'operator' };
}
