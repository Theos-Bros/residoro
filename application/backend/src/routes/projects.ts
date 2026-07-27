import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const PROJECT_TYPES = ['condo', 'subdivision', 'township', 'mixed_use'] as const;
const PROJECT_STATUSES = ['pre_selling', 'under_construction', 'ready_for_occupancy', 'sold_out'] as const;

type CreateDeveloperBody = {
  name?: string;
  contact_info?: Record<string, unknown>;
};

type CreateProjectBody = {
  developer_id?: string;
  name?: string;
  project_type?: string;
  location?: string;
  total_units?: number;
  status?: string;
};

type UpdateProjectBody = {
  name?: string;
  project_type?: string;
  location?: string;
  total_units?: number;
  status?: string;
};

// tb-properties-project-001: developers is a minimal placeholder entity
// (cap-properties-001 Decision #2) -- just enough to unblock Project's FK.
// No PATCH/DELETE routes yet -- not needed until something asks to edit a
// developer's own details, which this tracer bullet's DoD doesn't require.
export async function registerProjectsRoutes(app: FastifyInstance) {
  app.get('/developers', { preHandler: requireAuth }, async (request, reply) => {
    const { data, error } = await supabaseAdmin
      .from('developers')
      .select('id, name, contact_info')
      .eq('tenant_id', request.user!.tenantId)
      .order('name', { ascending: true });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load developers' });
    }

    return { developers: data ?? [] };
  });

  app.post<{ Body: CreateDeveloperBody }>('/developers', { preHandler: requireAuth }, async (request, reply) => {
    const { name, contact_info } = request.body ?? {};

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'name is required' });
    }

    const { data: developer, error } = await supabaseAdmin
      .from('developers')
      .insert({
        tenant_id: request.user!.tenantId,
        created_by: request.user!.id,
        name: name.trim(),
        contact_info: contact_info ?? null,
      })
      .select('id, name, contact_info')
      .single();

    if (error || !developer) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not create the developer' });
    }

    return reply.status(201).send(developer);
  });

  app.get('/projects', { preHandler: requireAuth }, async (request, reply) => {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('id, developer_id, name, project_type, location, total_units, status, developers(name)')
      .eq('tenant_id', request.user!.tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load projects' });
    }

    const projects = (data as unknown as Array<{
      id: string;
      developer_id: string;
      name: string;
      project_type: string;
      location: string | null;
      total_units: number | null;
      status: string;
      developers: { name: string } | null;
    }>).map((p) => ({
      id: p.id,
      developer_id: p.developer_id,
      developer_name: p.developers?.name ?? '',
      name: p.name,
      project_type: p.project_type,
      location: p.location,
      total_units: p.total_units,
      status: p.status,
    }));

    return { projects };
  });

  app.get<{ Params: { id: string } }>('/projects/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .select('id, developer_id, name, project_type, location, total_units, status, developers(name)')
      .eq('id', request.params.id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load the project' });
    }
    if (!project) {
      return reply.status(404).send({ error: 'Project not found in your workspace' });
    }

    const row = project as unknown as {
      id: string;
      developer_id: string;
      name: string;
      project_type: string;
      location: string | null;
      total_units: number | null;
      status: string;
      developers: { name: string } | null;
    };

    return {
      id: row.id,
      developer_id: row.developer_id,
      developer_name: row.developers?.name ?? '',
      name: row.name,
      project_type: row.project_type,
      location: row.location,
      total_units: row.total_units,
      status: row.status,
    };
  });

  // developer_id is re-checked against the caller's own tenant (not just
  // trusted from the request body) -- same "never trust tenant scoping from
  // the body" precedent as every other tenant-scoped write route in this
  // codebase (see listings.ts POST /listings).
  app.post<{ Body: CreateProjectBody }>('/projects', { preHandler: requireAuth }, async (request, reply) => {
    const { developer_id, name, project_type, location, total_units, status } = request.body ?? {};

    if (!developer_id || !name || !project_type) {
      return reply.status(400).send({ error: 'developer_id, name, and project_type are required' });
    }
    if (!PROJECT_TYPES.includes(project_type as (typeof PROJECT_TYPES)[number])) {
      return reply.status(400).send({ error: `project_type must be one of: ${PROJECT_TYPES.join(', ')}` });
    }
    if (status !== undefined && !PROJECT_STATUSES.includes(status as (typeof PROJECT_STATUSES)[number])) {
      return reply.status(400).send({ error: `status must be one of: ${PROJECT_STATUSES.join(', ')}` });
    }
    if (total_units !== undefined && (typeof total_units !== 'number' || !Number.isInteger(total_units) || total_units < 0)) {
      return reply.status(400).send({ error: 'total_units must be a non-negative integer' });
    }

    const { data: developer, error: developerError } = await supabaseAdmin
      .from('developers')
      .select('id')
      .eq('id', developer_id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle();

    if (developerError) {
      request.log.error(developerError);
      return reply.status(500).send({ error: 'Could not verify the developer' });
    }
    if (!developer) {
      return reply.status(404).send({ error: 'Developer not found in your workspace' });
    }

    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .insert({
        tenant_id: request.user!.tenantId,
        created_by: request.user!.id,
        developer_id,
        name,
        project_type,
        location,
        total_units,
        status: status ?? 'pre_selling',
      })
      .select('id, developer_id, name, project_type, location, total_units, status')
      .single();

    if (error || !project) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not create the project' });
    }

    return reply.status(201).send(project);
  });

  app.patch<{ Params: { id: string }; Body: UpdateProjectBody }>(
    '/projects/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { name, project_type, location, total_units, status } = request.body ?? {};

      if (project_type !== undefined && !PROJECT_TYPES.includes(project_type as (typeof PROJECT_TYPES)[number])) {
        return reply.status(400).send({ error: `project_type must be one of: ${PROJECT_TYPES.join(', ')}` });
      }
      if (status !== undefined && !PROJECT_STATUSES.includes(status as (typeof PROJECT_STATUSES)[number])) {
        return reply.status(400).send({ error: `status must be one of: ${PROJECT_STATUSES.join(', ')}` });
      }
      if (total_units !== undefined && (typeof total_units !== 'number' || !Number.isInteger(total_units) || total_units < 0)) {
        return reply.status(400).send({ error: 'total_units must be a non-negative integer' });
      }

      const { data: project, error } = await supabaseAdmin
        .from('projects')
        .update({
          ...(name !== undefined && { name }),
          ...(project_type !== undefined && { project_type }),
          ...(location !== undefined && { location }),
          ...(total_units !== undefined && { total_units }),
          ...(status !== undefined && { status }),
        })
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('id, developer_id, name, project_type, location, total_units, status')
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update the project' });
      }
      if (!project) {
        return reply.status(404).send({ error: 'Project not found in your workspace' });
      }

      return project;
    },
  );
}
