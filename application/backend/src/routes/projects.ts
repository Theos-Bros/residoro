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
// tb-properties-project-rollup-001: mirrors properties.status's check
// constraint (20260721120000_platform_foundation.sql) -- no shared-types
// package in this codebase, so kept in sync by hand like every other enum.
const PROPERTY_STATUSES = ['available', 'reserved', 'sold', 'off_market'] as const;
type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

function emptyStatusCounts(): Record<PropertyStatus, number> {
  return { available: 0, reserved: 0, sold: 0, off_market: 0 };
}

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
  unit_numbers?: string[];
};

type RemoveUnitsBody = {
  unit_numbers?: string[];
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
    .select('id, name, developer_id, total_units')
    .eq('id', projectId)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ id: string; name: string; developer_id: string; total_units: number | null }>();
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

  // tb-properties-project-rollup-001 follow-up: the operator supplies the
  // actual unit/lot labels (e.g. "1F", "Block 3 Lot 12") rather than a bare
  // count -- these are free-form per floor-plan/development convention, not
  // something the system can auto-number correctly for both condo (floor +
  // unit letter) and house-and-lot (block + lot) developments alike.
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

      const rawUnitNumbers = request.body?.unit_numbers;
      if (!Array.isArray(rawUnitNumbers) || rawUnitNumbers.length === 0) {
        return reply.status(400).send({ error: 'unit_numbers must be a non-empty array' });
      }
      if (rawUnitNumbers.length > MAX_GENERATE_COUNT) {
        return reply.status(400).send({ error: `unit_numbers cannot exceed ${MAX_GENERATE_COUNT} entries` });
      }
      const unitNumbers = rawUnitNumbers.map((n) => (typeof n === 'string' ? n.trim() : ''));
      if (unitNumbers.some((n) => n.length === 0)) {
        return reply.status(400).send({ error: 'unit_numbers must all be non-empty strings' });
      }
      if (new Set(unitNumbers).size !== unitNumbers.length) {
        return reply.status(400).send({ error: 'unit_numbers must not contain duplicates' });
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

      // tb-properties-project-rollup-001 follow-up (unit removal): unit_number
      // must be unique per unit type so a removal request can unambiguously
      // resolve a label back to exactly one property row.
      const { data: existingUnitNumbers, error: existingError } = await supabaseAdmin
        .from('properties')
        .select('unit_number')
        .eq('unit_type_id', unitType.id)
        .in('unit_number', unitNumbers);

      if (existingError) {
        request.log.error(existingError);
        return reply.status(500).send({ error: 'Could not verify unit numbers' });
      }
      if (existingUnitNumbers && existingUnitNumbers.length > 0) {
        const collisions = existingUnitNumbers.map((r: { unit_number: string | null }) => r.unit_number).join(', ');
        return reply.status(400).send({ error: `Unit numbers already exist for this unit type: ${collisions}` });
      }

      const rows = unitNumbers.map((unitNumber) => ({
        tenant_id: request.user!.tenantId,
        created_by: request.user!.id,
        project_id: request.params.id,
        unit_type_id: unitType.id,
        unit_number: unitNumber,
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
      }));

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

  // tb-properties-project-rollup-001: computed live on every request, no
  // caching/materialized column -- aggregated in application code (one query
  // for properties, one for unit-type names) rather than a SQL GROUP BY,
  // matching coverPhotoUrlsByProperty's precedent in listings.ts.
  app.get<{ Params: { id: string } }>(
    '/projects/:id/units-summary',
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

      const [propertiesResult, unitTypesResult] = await Promise.all([
        supabaseAdmin
          .from('properties')
          .select('id, status, unit_type_id, unit_number, title')
          .eq('project_id', request.params.id),
        supabaseAdmin
          .from('project_unit_types')
          .select('id, name')
          .eq('project_id', request.params.id)
          .order('created_at', { ascending: true }),
      ]);

      if (propertiesResult.error || unitTypesResult.error) {
        request.log.error(propertiesResult.error ?? unitTypesResult.error);
        return reply.status(500).send({ error: 'Could not load the units summary' });
      }

      type UnitTypeBucket = {
        unit_type_id: string | null;
        unit_type_name: string;
        total: number;
        by_status: Record<PropertyStatus, number>;
        // tb-properties-project-rollup-001 follow-up: the unit/lot label for
        // each property in this status bucket (unit_number if set, falling
        // back to the property's own title for pre-existing rows generated
        // before unit_number existed -- never backfilled, per decision).
        units_by_status: Record<PropertyStatus, string[]>;
      };

      function emptyUnitLists(): Record<PropertyStatus, string[]> {
        return { available: [], reserved: [], sold: [], off_market: [] };
      }

      // Seeded from project_unit_types first (in creation order) so a unit
      // type with zero generated units still appears -- an "Other" bucket
      // for unit_type_id = null is added lazily below only if it's ever hit.
      const buckets = new Map<string | null, UnitTypeBucket>();
      for (const unitType of (unitTypesResult.data ?? []) as Array<{ id: string; name: string }>) {
        buckets.set(unitType.id, {
          unit_type_id: unitType.id,
          unit_type_name: unitType.name,
          total: 0,
          by_status: emptyStatusCounts(),
          units_by_status: emptyUnitLists(),
        });
      }

      const by_status = emptyStatusCounts();
      let total = 0;

      for (const row of (propertiesResult.data ?? []) as Array<{
        id: string;
        status: PropertyStatus;
        unit_type_id: string | null;
        unit_number: string | null;
        title: string;
      }>) {
        total += 1;
        by_status[row.status] += 1;

        let bucket = buckets.get(row.unit_type_id);
        if (!bucket) {
          bucket = {
            unit_type_id: row.unit_type_id,
            unit_type_name: row.unit_type_id === null ? 'Other' : 'Unknown unit type',
            total: 0,
            by_status: emptyStatusCounts(),
            units_by_status: emptyUnitLists(),
          };
          buckets.set(row.unit_type_id, bucket);
        }
        bucket.total += 1;
        bucket.by_status[row.status] += 1;
        bucket.units_by_status[row.status].push(row.unit_number ?? row.title);
      }

      return {
        total,
        by_status,
        declared_total_units: project.total_units,
        by_unit_type: Array.from(buckets.values()),
      };
    },
  );

  // tb-properties-project-rollup-001 follow-up: lets an operator correct
  // accidental bulk-generation (typo'd or extra unit/lot numbers) by
  // removing specific units by their labels, scoped to one unit type.
  // Admin-only (destructive, same gating as project_unit_types' own delete
  // RLS policy, even though no DELETE route exists for unit types yet).
  // Restricted to status = 'available' -- a unit that's already reserved or
  // sold is a real transaction record, not a typo, and removing one is a
  // different, more consequential action than fixing a data-entry mistake.
  app.delete<{ Params: { id: string; unitTypeId: string }; Body: RemoveUnitsBody }>(
    '/projects/:id/unit-types/:unitTypeId/units',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.user!.role !== 'admin') {
        return reply.status(403).send({ error: 'Only a workspace admin can remove generated units' });
      }

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

      const rawUnitNumbers = request.body?.unit_numbers;
      if (!Array.isArray(rawUnitNumbers) || rawUnitNumbers.length === 0) {
        return reply.status(400).send({ error: 'unit_numbers must be a non-empty array' });
      }
      if (rawUnitNumbers.length > MAX_GENERATE_COUNT) {
        return reply.status(400).send({ error: `unit_numbers cannot exceed ${MAX_GENERATE_COUNT} entries` });
      }
      const unitNumbers = rawUnitNumbers.map((n) => (typeof n === 'string' ? n.trim() : ''));
      if (unitNumbers.some((n) => n.length === 0)) {
        return reply.status(400).send({ error: 'unit_numbers must all be non-empty strings' });
      }
      if (new Set(unitNumbers).size !== unitNumbers.length) {
        return reply.status(400).send({ error: 'unit_numbers must not contain duplicates' });
      }

      const { data: unitType, error: unitTypeError } = await supabaseAdmin
        .from('project_unit_types')
        .select('id, name')
        .eq('id', request.params.unitTypeId)
        .eq('project_id', request.params.id)
        .maybeSingle<{ id: string; name: string }>();

      if (unitTypeError) {
        request.log.error(unitTypeError);
        return reply.status(500).send({ error: 'Could not verify the unit type' });
      }
      if (!unitType) {
        return reply.status(404).send({ error: 'Unit type not found for this project' });
      }

      const { data: matches, error: matchError } = await supabaseAdmin
        .from('properties')
        .select('id, unit_number, status')
        .eq('tenant_id', request.user!.tenantId)
        .eq('unit_type_id', unitType.id)
        .in('unit_number', unitNumbers);

      if (matchError) {
        request.log.error(matchError);
        return reply.status(500).send({ error: 'Could not look up the requested units' });
      }

      const found = (matches ?? []) as Array<{ id: string; unit_number: string | null; status: PropertyStatus }>;
      const foundByLabel = new Map(found.map((p) => [p.unit_number, p]));

      const notFound = unitNumbers.filter((label) => !foundByLabel.has(label));
      const notAvailable = unitNumbers.filter((label) => {
        const match = foundByLabel.get(label);
        return match !== undefined && match.status !== 'available';
      });

      if (notFound.length > 0 || notAvailable.length > 0) {
        return reply.status(400).send({
          error: 'Some requested units could not be removed',
          not_found: notFound,
          not_available: notAvailable,
        });
      }

      const idsToDelete = unitNumbers.map((label) => foundByLabel.get(label)!.id);

      const { error: deleteError } = await supabaseAdmin
        .from('properties')
        .delete()
        .eq('tenant_id', request.user!.tenantId)
        .in('id', idsToDelete);

      if (deleteError) {
        request.log.error(deleteError);
        return reply.status(500).send({ error: 'Could not remove the requested units' });
      }

      return { deleted: idsToDelete.length, unit_numbers: unitNumbers };
    },
  );
}
