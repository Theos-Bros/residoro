import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { canEditSetting } from '../lib/settingsDelegation.js';

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

type RoutingSettingsBody = { task_type?: string; default_assignee_id?: string | null };

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
    return { tasks: data ?? [] };
  });

  // Powers the assignee picker on both TaskDetailPanel and
  // TaskRoutingSettingsPanel -- any tenant member can create/reassign a task,
  // so this list (unlike /settings/permissions' admin-only members list) is
  // reachable by any authenticated tenant member.
  app.get('/tasks/assignees', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, handle')
      .eq('tenant_id', request.user!.tenantId)
      .order('full_name', { ascending: true });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load tenant members' });
    }
    return { members: data ?? [] };
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
    // not an error.
    if (!resolvedAssigneeId) {
      const { data: routing, error: routingError } = await supabase
        .from('workspace_task_routing_settings')
        .select('default_assignee_id')
        .eq('tenant_id', request.user!.tenantId)
        .eq('task_type', resolvedTaskType)
        .maybeSingle<{ default_assignee_id: string | null }>();

      if (routingError) {
        request.log.error(routingError);
        return reply.status(500).send({ error: 'Could not look up routing settings' });
      }
      resolvedAssigneeId = routing?.default_assignee_id ?? null;
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
    return reply.status(201).send(data);
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
    return data;
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
      return data;
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
      .select('task_type, default_assignee_id')
      .eq('tenant_id', tenantId)
      .returns<{ task_type: string; default_assignee_id: string | null }[]>();

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

    const { task_type, default_assignee_id } = request.body ?? {};
    if (!task_type || !task_type.trim()) {
      return reply.status(400).send({ error: 'task_type is required' });
    }

    const { data, error } = await supabase
      .from('workspace_task_routing_settings')
      .upsert(
        { tenant_id: tenantId, task_type: task_type.trim(), default_assignee_id: default_assignee_id ?? null },
        { onConflict: 'tenant_id,task_type' },
      )
      .select('task_type, default_assignee_id')
      .single();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not save routing settings' });
    }
    return { ...data, can_edit: true };
  });
}
