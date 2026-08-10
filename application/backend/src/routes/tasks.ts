import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { canEditSetting } from '../lib/settingsDelegation.js';
import { formatDisplayName } from '../lib/displayName.js';

// tb-buyer-leads-stage-tasks-001: shared by POST /tasks (below) and
// stageTaskGeneration.ts's stage-change trigger, so both routes' notion of
// "what does this task_type's default routing resolve to" stays identical.
// assignee_role = 'admin' resolves to the tenant's single admin profile,
// deterministic because tb-brokerage-permissions-admin-uniqueness-001
// guarantees exactly one admin-role profile per tenant.
export async function resolveRoutedAssignee(
  supabase: SupabaseClient,
  tenantId: string,
  taskType: string,
): Promise<string | null> {
  const { data: routing, error: routingError } = await supabase
    .from('workspace_task_routing_settings')
    .select('default_assignee_id, assignee_role')
    .eq('tenant_id', tenantId)
    .eq('task_type', taskType)
    .maybeSingle<{ default_assignee_id: string | null; assignee_role: 'admin' | null }>();

  if (routingError) throw routingError;
  if (!routing) return null;

  if (routing.assignee_role === 'admin') {
    const { data: admin, error: adminError } = await supabase
      .from('profiles')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('role', 'admin')
      .maybeSingle<{ id: string }>();
    if (adminError) throw adminError;
    return admin?.id ?? null;
  }

  return routing.default_assignee_id ?? null;
}

const STATUSES = ['open', 'in_progress', 'done'] as const;

type TaskRow = {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  status: (typeof STATUSES)[number];
  due_date: string | null;
  assignee_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  task_type: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// tb-tasks-linked-entity-display-001: `entity_type`/`entity_id` is a
// deliberately FK-less polymorphic link (see tasks_schema migration), so
// resolving a display name is a per-type lookup -- one single-table select
// per entity_type actually present in the batch, not a generic join. Batches
// across every task in a list response (GET /tasks) or wraps a single task
// (GET /tasks/:id) so both call sites share one implementation and stay in
// sync. Returns a lookup function rather than a plain Map so callers don't
// need to know the `${entity_type}:${entity_id}` key format.
async function resolveEntityNames(
  supabase: SupabaseClient,
  tenantId: string,
  tasks: Pick<TaskRow, 'entity_type' | 'entity_id'>[],
): Promise<(task: Pick<TaskRow, 'entity_type' | 'entity_id'>) => string | null> {
  const idsByType = new Map<string, Set<string>>();
  for (const task of tasks) {
    if (!task.entity_type || !task.entity_id) continue;
    const set = idsByType.get(task.entity_type) ?? new Set<string>();
    set.add(task.entity_id);
    idsByType.set(task.entity_type, set);
  }

  const nameByKey = new Map<string, string | null>();

  const buyerRequirementIds = idsByType.get('buyer_requirement');
  if (buyerRequirementIds?.size) {
    // A Lead has no name of its own -- it's always the linked contact's name
    // (same derivation LeadDetailPanel/LeadsPage already use).
    const { data, error } = await supabase
      .from('buyer_requirements')
      .select('id, contacts(name)')
      .eq('tenant_id', tenantId)
      .in('id', [...buyerRequirementIds])
      .returns<{ id: string; contacts: { name: string } | null }[]>();
    if (error) throw error;
    for (const row of data ?? []) {
      nameByKey.set(`buyer_requirement:${row.id}`, row.contacts?.name ?? null);
    }
  }

  const propertyIds = idsByType.get('property');
  if (propertyIds?.size) {
    const { data, error } = await supabase
      .from('properties')
      .select('id, title')
      .eq('tenant_id', tenantId)
      .in('id', [...propertyIds])
      .returns<{ id: string; title: string }[]>();
    if (error) throw error;
    for (const row of data ?? []) {
      nameByKey.set(`property:${row.id}`, row.title);
    }
  }

  const listingIds = idsByType.get('listing');
  if (listingIds?.size) {
    // A listing has no title of its own -- confirmed still true at
    // implementation time (2026-08-11): listings.ts's own row shape has no
    // title/name column, only a property_id join through to properties.title
    // (same as CalendarPage.tsx/viewings.ts already resolve elsewhere).
    const { data, error } = await supabase
      .from('listings')
      .select('id, properties(title)')
      .eq('tenant_id', tenantId)
      .in('id', [...listingIds])
      .returns<{ id: string; properties: { title: string } | null }[]>();
    if (error) throw error;
    for (const row of data ?? []) {
      nameByKey.set(`listing:${row.id}`, row.properties?.title ?? null);
    }
  }

  const contactIds = idsByType.get('contact');
  if (contactIds?.size) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .in('id', [...contactIds])
      .returns<{ id: string; name: string }[]>();
    if (error) throw error;
    for (const row of data ?? []) {
      nameByKey.set(`contact:${row.id}`, row.name);
    }
  }

  return (task) => {
    if (!task.entity_type || !task.entity_id) return null;
    return nameByKey.get(`${task.entity_type}:${task.entity_id}`) ?? null;
  };
}

type ListQuery = {
  status?: string;
  assignee_id?: string;
  entity_type?: string;
  entity_id?: string;
  due_before?: string;
  due_after?: string;
};

type CreateTaskBody = {
  title?: string;
  description?: string;
  due_date?: string;
  task_type?: string;
  entity_type?: string;
  entity_id?: string;
  assignee_id?: string;
};

type UpdateTaskBody = {
  title?: string;
  description?: string;
  status?: string;
  due_date?: string | null;
  assignee_id?: string | null;
  task_type?: string;
};

type RoutingSettingsBody = {
  task_type?: string;
  default_assignee_id?: string | null;
  assignee_role?: 'admin' | null;
};

// tb-tasks-crud-001: TB1 of cap-tasks-001 -- task records, full CRUD,
// manual/routed assignment, and the 'tasks' Settings sub-section that
// configures default-assignee-per-task-type routing.
export async function registerTasksRoutes(app: FastifyInstance) {
  app.get<{ Querystring: ListQuery }>('/tasks', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { status, assignee_id, entity_type, entity_id, due_before, due_after } = request.query;

    if (status && !(STATUSES as readonly string[]).includes(status)) {
      return reply.status(400).send({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }

    let query = supabase
      .from('tasks')
      .select('*')
      .eq('tenant_id', request.user!.tenantId)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (assignee_id) query = query.eq('assignee_id', assignee_id);
    if (entity_type) query = query.eq('entity_type', entity_type);
    if (entity_id) query = query.eq('entity_id', entity_id);
    if (due_before) query = query.lte('due_date', due_before);
    if (due_after) query = query.gte('due_date', due_after);

    const { data, error } = await query.returns<TaskRow[]>();
    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load tasks' });
    }

    const tasks = data ?? [];
    let entityNameFor: (task: TaskRow) => string | null;
    try {
      entityNameFor = await resolveEntityNames(supabase, request.user!.tenantId, tasks);
    } catch (resolveError) {
      request.log.error(resolveError);
      return reply.status(500).send({ error: 'Could not resolve linked-entity names' });
    }

    return { tasks: tasks.map((task) => ({ ...task, entity_name: entityNameFor(task) })) };
  });

  // Powers the assignee picker on both TaskDetailPanel and
  // TaskRoutingSettingsPanel -- any tenant member can create/reassign a task,
  // so this list (unlike /settings/permissions' admin-only members list) is
  // reachable by any authenticated tenant member.
  app.get('/tasks/assignees', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, handle')
      .eq('tenant_id', request.user!.tenantId)
      .order('first_name', { ascending: true })
      .order('last_name', { ascending: true });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load tenant members' });
    }

    type AssigneeRow = { id: string; first_name: string | null; last_name: string | null; handle: string | null };
    const members = ((data ?? []) as AssigneeRow[]).map((row) => ({
      id: row.id,
      full_name: formatDisplayName(row.first_name, row.last_name),
      handle: row.handle,
    }));

    return { members };
  });

  app.post<{ Body: CreateTaskBody }>('/tasks', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { title, description, due_date, task_type, entity_type, entity_id, assignee_id } = request.body ?? {};

    if (!title || !title.trim()) {
      return reply.status(400).send({ error: 'title is required' });
    }
    if ((entity_type && !entity_id) || (!entity_type && entity_id)) {
      return reply.status(400).send({ error: 'entity_type and entity_id must both be given, or both omitted' });
    }

    const resolvedTaskType = task_type?.trim() || 'manual';
    let resolvedAssigneeId = assignee_id ?? null;

    // tb-tasks-crud-001 End-to-End Flow step 1: no explicit assignee ->
    // look up this tenant's default routing for the task_type. No row for
    // that task_type means "no default" -- the task is created unassigned,
    // not an error. tb-buyer-leads-stage-tasks-001 extended this lookup to
    // also resolve a role-based default ('admin').
    if (!resolvedAssigneeId) {
      try {
        resolvedAssigneeId = await resolveRoutedAssignee(supabase, request.user!.tenantId, resolvedTaskType);
      } catch (routingError) {
        request.log.error(routingError);
        return reply.status(500).send({ error: 'Could not look up routing settings' });
      }
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        tenant_id: request.user!.tenantId,
        created_by: request.user!.id,
        title: title.trim(),
        description: description ?? null,
        due_date: due_date ?? null,
        task_type: resolvedTaskType,
        entity_type: entity_type ?? null,
        entity_id: entity_id ?? null,
        assignee_id: resolvedAssigneeId,
      })
      .select('*')
      .single<TaskRow>();

    if (error || !data) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not create the task' });
    }

    // Same resolution as GET /tasks and GET /tasks/:id -- keeps every
    // response shape carrying entity_name consistent, so a caller that
    // replaces its local task state wholesale from a create/update response
    // (see TaskDetailPanel.tsx) never has to fall back to a stale value.
    let entityNameFor: (task: TaskRow) => string | null;
    try {
      entityNameFor = await resolveEntityNames(supabase, request.user!.tenantId, [data]);
    } catch (resolveError) {
      request.log.error(resolveError);
      return reply.status(500).send({ error: 'Could not resolve linked-entity name' });
    }
    return reply.status(201).send({ ...data, entity_name: entityNameFor(data) });
  });

  app.get<{ Params: { id: string } }>('/tasks/:id', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', request.params.id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle<TaskRow>();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load the task' });
    }
    if (!data) {
      return reply.status(404).send({ error: 'Task not found in your workspace' });
    }

    let entityNameFor: (task: TaskRow) => string | null;
    try {
      entityNameFor = await resolveEntityNames(supabase, request.user!.tenantId, [data]);
    } catch (resolveError) {
      request.log.error(resolveError);
      return reply.status(500).send({ error: 'Could not resolve the linked-entity name' });
    }
    return { ...data, entity_name: entityNameFor(data) };
  });

  app.patch<{ Params: { id: string }; Body: UpdateTaskBody }>(
    '/tasks/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { title, description, status, due_date, assignee_id, task_type } = request.body ?? {};

      if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) {
        return reply.status(400).send({ error: `status must be one of: ${STATUSES.join(', ')}` });
      }

      const updateFields: Record<string, unknown> = {};
      if (title !== undefined) {
        if (!title.trim()) return reply.status(400).send({ error: 'title cannot be empty' });
        updateFields.title = title.trim();
      }
      if (description !== undefined) updateFields.description = description;
      if (status !== undefined) updateFields.status = status;
      if (due_date !== undefined) updateFields.due_date = due_date;
      if (assignee_id !== undefined) updateFields.assignee_id = assignee_id;
      if (task_type !== undefined) updateFields.task_type = task_type;

      const { data, error } = await supabase
        .from('tasks')
        .update(updateFields)
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('*')
        .maybeSingle<TaskRow>();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update the task' });
      }
      if (!data) {
        return reply.status(404).send({ error: 'Task not found in your workspace' });
      }

      let entityNameFor: (task: TaskRow) => string | null;
      try {
        entityNameFor = await resolveEntityNames(supabase, request.user!.tenantId, [data]);
      } catch (resolveError) {
        request.log.error(resolveError);
        return reply.status(500).send({ error: 'Could not resolve the linked-entity name' });
      }
      return { ...data, entity_name: entityNameFor(data) };
    },
  );

  // Admin-only delete, matching every other entity's RLS shape in this
  // codebase (contacts, buyer_requirements, inquiries).
  app.delete<{ Params: { id: string } }>('/tasks/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user!.role !== 'admin') {
      return reply.status(403).send({ error: 'Only an admin can delete a task' });
    }

    const supabase = getScopedClient(request);
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', request.params.id)
      .eq('tenant_id', request.user!.tenantId);

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not delete the task' });
    }
    return reply.status(204).send();
  });

  app.get('/settings/tasks', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const tenantId = request.user!.tenantId;

    const { data: rules, error: rulesError } = await supabase
      .from('workspace_task_routing_settings')
      .select('task_type, default_assignee_id, assignee_role')
      .eq('tenant_id', tenantId)
      .returns<{ task_type: string; default_assignee_id: string | null; assignee_role: 'admin' | null }[]>();

    if (rulesError) {
      request.log.error(rulesError);
      return reply.status(500).send({ error: 'Could not load routing settings' });
    }

    // "Known" task_types: whatever routing rules already exist, plus every
    // distinct task_type actually in use, plus 'manual' as the always-present
    // baseline -- task_type is open text (cap-tasks-001), so there's no fixed
    // enum to enumerate instead.
    const { data: distinctTasks, error: distinctError } = await supabase
      .from('tasks')
      .select('task_type')
      .eq('tenant_id', tenantId)
      .returns<{ task_type: string }[]>();

    if (distinctError) {
      request.log.error(distinctError);
      return reply.status(500).send({ error: 'Could not load task types' });
    }

    const taskTypes = new Set<string>(['manual']);
    for (const rule of rules ?? []) taskTypes.add(rule.task_type);
    for (const row of distinctTasks ?? []) taskTypes.add(row.task_type);

    const can_edit = await canEditSetting(supabase, tenantId, request.user!.id, request.user!.role, 'tasks');
    return { task_types: [...taskTypes].sort(), routing_rules: rules ?? [], can_edit };
  });

  app.patch<{ Body: RoutingSettingsBody }>('/settings/tasks', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const tenantId = request.user!.tenantId;

    const canEdit = await canEditSetting(supabase, tenantId, request.user!.id, request.user!.role, 'tasks');
    if (!canEdit) {
      return reply.status(403).send({ error: 'Only an admin or a delegated member can edit task routing settings' });
    }

    const { task_type, default_assignee_id, assignee_role } = request.body ?? {};
    if (!task_type || !task_type.trim()) {
      return reply.status(400).send({ error: 'task_type is required' });
    }
    if (default_assignee_id && assignee_role) {
      return reply.status(400).send({ error: 'default_assignee_id and assignee_role cannot both be given' });
    }
    if (assignee_role && assignee_role !== 'admin') {
      return reply.status(400).send({ error: "assignee_role must be 'admin'" });
    }

    // Explicitly null out whichever field wasn't given, so switching a rule
    // from "person" to "the admin" (or back) fully replaces the prior
    // default rather than leaving a stale value in the unused column.
    const { data, error } = await supabase
      .from('workspace_task_routing_settings')
      .upsert(
        {
          tenant_id: tenantId,
          task_type: task_type.trim(),
          default_assignee_id: assignee_role ? null : (default_assignee_id ?? null),
          assignee_role: assignee_role ?? null,
        },
        { onConflict: 'tenant_id,task_type' },
      )
      .select('task_type, default_assignee_id, assignee_role')
      .single();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not save routing settings' });
    }
    return { ...data, can_edit: true };
  });
}
