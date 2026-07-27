import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const PROJECT_TYPES = ['condo', 'subdivision', 'township', 'mixed_use'] as const;
const PROJECT_STATUSES = ['pre_selling', 'under_construction', 'ready_for_occupancy', 'sold_out'] as const;
const PROPERTY_TYPES = [
  'condo_unit',
  'house_and_lot',
  'lot_only',
  'townhouse',
  'commercial',
  'warehouse',
  'agricultural',
  'industrial',
] as const;

// tb-properties-bulk-units-001: comfortably above the "100+ units" Success
// Criteria bar while bounding worst-case request cost -- a project can still
// exceed this across multiple generate-units calls, just not in one request.
const MAX_GENERATE_COUNT = 1000;

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

type CreateUnitTypeBody = {
  name?: string;
  property_type?: string;
  floor_area_sqm?: number;
  lot_area_sqm?: number;
  bedrooms?: number;
  bathrooms?: number;
  parking_slots?: number;
  price?: number;
  price_currency?: string;
};

type GenerateUnitsBody = {
  count?: number;
};

type ProjectUnitTypeRow = {
  id: string;
  project_id: string;
  name: string;
  property_type: string;
  floor_area_sqm: number | null;
  lot_area_sqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking_slots: number | null;
  price: number | null;
  price_currency: string;
};

// tb-properties-bulk-units-001: every unit-types/generate-units route re-
// verifies project_id against the caller's own tenant first -- same "never
// trust tenant scoping from the URL/body alone" precedent as every other
// write route in this codebase (see listings.ts, propertyMedia.ts).
async function loadOwnedProject(tenantId: string, projectId: string) {
  return supabaseAdmin
    .from('projects')
    .select('id, name, developer_id')
    .eq('id', projectId)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ id: string; name: string; developer_id: string }>();
}

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

  // tb-properties-bulk-units-001: no PATCH/DELETE route yet -- v1 is
  // create-only (see semantic_scope), matching properties' own no-generic-
  // edit convention rather than introducing one just for this new entity.
  app.get<{ Params: { id: string } }>(
    '/projects/:id/unit-types',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { data: project, error: projectError } = await loadOwnedProject(
        request.user!.tenantId,
        request.params.id,
      );
      if (projectError) {
        request.log.error(projectError);
        return reply.status(500).send({ error: 'Could not verify the project' });
      }
      if (!project) {
        return reply.status(404).send({ error: 'Project not found in your workspace' });
      }

      const { data, error } = await supabaseAdmin
        .from('project_unit_types')
        .select(
          'id, project_id, name, property_type, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots, price, price_currency',
        )
        .eq('project_id', request.params.id)
        .order('created_at', { ascending: true });

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not load unit types' });
      }

      return { unit_types: (data ?? []) as ProjectUnitTypeRow[] };
    },
  );

  app.post<{ Params: { id: string }; Body: CreateUnitTypeBody }>(
    '/projects/:id/unit-types',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { data: project, error: projectError } = await loadOwnedProject(
        request.user!.tenantId,
        request.params.id,
      );
      if (projectError) {
        request.log.error(projectError);
        return reply.status(500).send({ error: 'Could not verify the project' });
      }
      if (!project) {
        return reply.status(404).send({ error: 'Project not found in your workspace' });
      }

      const {
        name,
        property_type,
        floor_area_sqm,
        lot_area_sqm,
        bedrooms,
        bathrooms,
        parking_slots,
        price,
        price_currency,
      } = request.body ?? {};

      if (!name || !name.trim() || !property_type) {
        return reply.status(400).send({ error: 'name and property_type are required' });
      }
      if (!PROPERTY_TYPES.includes(property_type as (typeof PROPERTY_TYPES)[number])) {
        return reply.status(400).send({ error: `property_type must be one of: ${PROPERTY_TYPES.join(', ')}` });
      }

      const numericFields = { floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots, price };
      for (const [field, value] of Object.entries(numericFields)) {
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
          return reply.status(400).send({ error: `${field} must be a non-negative number` });
        }
      }

      const { data: unitType, error } = await supabaseAdmin
        .from('project_unit_types')
        .insert({
          tenant_id: request.user!.tenantId,
          created_by: request.user!.id,
          project_id: request.params.id,
          name: name.trim(),
          property_type,
          floor_area_sqm,
          lot_area_sqm,
          bedrooms,
          bathrooms,
          parking_slots,
          price,
          price_currency: price_currency ?? 'PHP',
        })
        .select(
          'id, project_id, name, property_type, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots, price, price_currency',
        )
        .single();

      if (error || !unitType) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not create the unit type' });
      }

      return reply.status(201).send(unitType);
    },
  );

  // Auto-numbering: counts existing properties for this unit_type_id first,
  // so re-running generate-units later (e.g. to add more units to the same
  // floor plan) continues numbering rather than colliding with or
  // overwriting earlier-generated titles.
  app.post<{ Params: { id: string; unitTypeId: string }; Body: GenerateUnitsBody }>(
    '/projects/:id/unit-types/:unitTypeId/generate-units',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { data: project, error: projectError } = await loadOwnedProject(
        request.user!.tenantId,
        request.params.id,
      );
      if (projectError) {
        request.log.error(projectError);
        return reply.status(500).send({ error: 'Could not verify the project' });
      }
      if (!project) {
        return reply.status(404).send({ error: 'Project not found in your workspace' });
      }

      const { count } = request.body ?? {};
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_GENERATE_COUNT) {
        return reply
          .status(400)
          .send({ error: `count must be an integer between 1 and ${MAX_GENERATE_COUNT}` });
      }

      const { data: unitType, error: unitTypeError } = await supabaseAdmin
        .from('project_unit_types')
        .select(
          'id, project_id, name, property_type, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots, price, price_currency',
        )
        .eq('id', request.params.unitTypeId)
        .eq('project_id', request.params.id)
        .maybeSingle<ProjectUnitTypeRow>();

      if (unitTypeError) {
        request.log.error(unitTypeError);
        return reply.status(500).send({ error: 'Could not verify the unit type' });
      }
      if (!unitType) {
        return reply.status(404).send({ error: 'Unit type not found for this project' });
      }

      const { count: existingCount, error: countError } = await supabaseAdmin
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('unit_type_id', unitType.id);

      if (countError) {
        request.log.error(countError);
        return reply.status(500).send({ error: 'Could not determine unit numbering' });
      }

      const startingIndex = (existingCount ?? 0) + 1;
      const rows = Array.from({ length: count }, (_, i) => {
        const unitNumber = startingIndex + i;
        return {
          tenant_id: request.user!.tenantId,
          created_by: request.user!.id,
          project_id: request.params.id,
          unit_type_id: unitType.id,
          title: `${project.name} - ${unitType.name} - Unit ${unitNumber}`,
          type: unitType.property_type,
          owner_type: 'developer',
          owner_id: project.developer_id,
          floor_area_sqm: unitType.floor_area_sqm,
          lot_area_sqm: unitType.lot_area_sqm,
          bedrooms: unitType.bedrooms,
          bathrooms: unitType.bathrooms,
          parking_slots: unitType.parking_slots,
          price: unitType.price,
          price_currency: unitType.price_currency,
        };
      });

      const { data: created, error: insertError } = await supabaseAdmin
        .from('properties')
        .insert(rows)
        .select('id');

      if (insertError || !created) {
        request.log.error(insertError);
        return reply.status(500).send({ error: 'Could not generate units' });
      }

      return reply.status(201).send({
        created: created.length,
        property_ids: created.map((p: { id: string }) => p.id),
      });
    },
  );
}
