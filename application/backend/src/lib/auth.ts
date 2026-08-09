import type { FastifyReply, FastifyRequest } from 'fastify';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabaseAdmin.js';

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

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

export type AuthedIdentity = {
  id: string;
  role: string;
  email: string | null;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
    operator?: AuthedOperator;
    identity?: AuthedIdentity;
  }
}

type VerifiedProfile = {
  userId: string;
  tenantId: string | null;
  role: string;
  accessState: AccessState | null;
  email: string | null;
};

// Shared by requireAuth and requireOperator: verify the bearer token against
// Supabase Auth, then look up the caller's profile (with its workspace's
// access_state embedded via the tenant_id FK -- null for operators, who
// aren't tenant-scoped). Replies and returns undefined on any failure so
// callers can just check the return value.
export async function verifyBearerAndFetchProfile(
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
    email: userData.user.email ?? null,
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

// tb-user-profile-display-name-001: the shared-identity guard neither
// requireAuth nor requireOperator provides -- requireAuth rejects operators
// outright (tenant_id is null), requireOperator rejects tenant users. A
// profile is scoped to id = auth.uid() regardless of tenant/operator status,
// so this guard authenticates the caller and nothing more: no tenant or
// access_state branching, since profile-editing needs neither. Additive --
// requireAuth/requireOperator are unchanged, used exactly as today by every
// existing route.
export async function requireAnyIdentity(request: FastifyRequest, reply: FastifyReply) {
  const profile = await verifyBearerAndFetchProfile(request, reply);
  if (!profile) return;

  request.identity = { id: profile.userId, role: profile.role, email: profile.email };
}

// tb-client-lifecycle-migration-execution-001: migration is the one flow both
// an operator (acting on a client's behalf, per cap-client-lifecycle-001) and
// a brokerage caller (legacy self-service, no longer reachable from the UI
// but left working rather than deleted) can reach. requireAuth's caller's-
// own-tenant-only assumption doesn't fit an operator, who has no tenant_id of
// their own -- this resolves which tenant to scope to instead:
// - operator: tenant_id must come from ?tenant_id= (the client the operator
//   selected in the admin dashboard); never inferred, always explicit.
//   access_state is deliberately NOT enforced for operators -- the
//   active/read_only/blocked gate exists to stop an expired *client* from
//   self-servicing further action, not to stop an operator's own on-behalf-of
//   work.
// - non-operator: identical to requireAuth -- own tenant_id, own
//   access_state, any ?tenant_id= in the query string is ignored, so
//   self-service scoping can't be overridden by a crafted request.
// Re-running requireAuth for the non-operator branch costs one extra profile
// fetch rather than duplicating its blocked/read_only logic here -- an
// acceptable tracer-bullet tradeoff, not a hot path.
export async function requireMigrationAccess(request: FastifyRequest, reply: FastifyReply) {
  const profile = await verifyBearerAndFetchProfile(request, reply);
  if (!profile) return;

  if (profile.role === 'operator') {
    const targetTenantId = (request.query as Record<string, string> | undefined)?.tenant_id;
    if (!targetTenantId) {
      reply.status(400).send({ error: 'tenant_id is required for operator-driven migration calls' });
      return;
    }
    request.user = { id: profile.userId, tenantId: targetTenantId, role: 'operator', accessState: 'active' };
    return;
  }

  await requireAuth(request, reply);
}

// tb-platform-rls-scoped-client-001 / ADR-003: a per-request client scoped to
// the caller's own JWT, so the RLS policies already defined on every tenant-
// scoped table are the real enforcement boundary, not just this route's own
// .eq('tenant_id', ...) filter. Only call after requireAuth/requireOperator
// has already validated the bearer token -- this re-forwards the same header
// rather than re-verifying it, so it must run inside an authed route.
// Uses the publishable key (not the service-role key) as the apikey header;
// the Postgres role RLS actually sees comes from the forwarded Authorization
// JWT, not this key -- see ADR-002's Consequences section on why the
// service-role client bypasses RLS and this deliberately doesn't.
export function getScopedClient(request: FastifyRequest): SupabaseClient {
  if (!supabaseUrl || !publishableKey) {
    throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set (see .env).');
  }

  return createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: request.headers.authorization! } },
  });
}
