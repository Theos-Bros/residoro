const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type TaskStatus = 'open' | 'in_progress' | 'done';

export const TASK_STATUSES: readonly TaskStatus[] = ['open', 'in_progress', 'done'];

export type Task = {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  due_date: string | null;
  assignee_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  // tb-tasks-linked-entity-display-001: resolved server-side (GET/POST/PATCH
  // /tasks[/:id]) from entity_type/entity_id -- the linked record's real
  // display name, e.g. a Lead's contact name or a Listing's property title.
  // null whenever entity_type/entity_id are null (a standalone task).
  entity_name: string | null;
  task_type: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// tb-tasks-linked-entity-display-001: where a task's linked-entity name
// navigates to when clicked -- the list page that owns that entity's detail
// view. None of these entity types has a per-record route (see each list
// page's own location.state.openId effect), so this is a route + state pair,
// not a plain href. Keyed on the same entity_type values already written by
// TaskDetailPanel.tsx's prefillEntity / stageTaskGeneration.ts.
export const TASK_ENTITY_ROUTE: Record<string, string> = {
  buyer_requirement: '/leads',
  property: '/properties',
  listing: '/listings',
  contact: '/contacts',
};

export type TaskAssignee = { id: string; full_name: string; handle: string | null };

export type TaskRoutingRule = {
  task_type: string;
  default_assignee_id: string | null;
  assignee_role: 'admin' | null;
};

export type TaskRoutingSettings = {
  task_types: string[];
  routing_rules: TaskRoutingRule[];
  can_edit: boolean;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchTasks(
  accessToken: string,
  filters?: { status?: TaskStatus; assignee_id?: string; entity_type?: string; entity_id?: string },
): Promise<{ tasks: Task[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.assignee_id) params.set('assignee_id', filters.assignee_id);
  if (filters?.entity_type) params.set('entity_type', filters.entity_type);
  if (filters?.entity_id) params.set('entity_id', filters.entity_id);
  const query = params.toString();
  const response = await fetch(`${BACKEND_URL}/tasks${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchTaskAssignees(accessToken: string): Promise<{ members: TaskAssignee[] }> {
  const response = await fetch(`${BACKEND_URL}/tasks/assignees`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchTask(accessToken: string, id: string): Promise<Task> {
  const response = await fetch(`${BACKEND_URL}/tasks/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function createTask(
  accessToken: string,
  input: {
    title: string;
    description?: string;
    due_date?: string;
    task_type?: string;
    entity_type?: string;
    entity_id?: string;
    assignee_id?: string;
  },
): Promise<Task> {
  const response = await fetch(`${BACKEND_URL}/tasks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function updateTask(
  accessToken: string,
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    status: TaskStatus;
    due_date: string | null;
    assignee_id: string | null;
    task_type: string;
  }>,
): Promise<Task> {
  const response = await fetch(`${BACKEND_URL}/tasks/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return parseJsonOrThrow(response);
}

export async function deleteTask(accessToken: string, id: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/tasks/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
}

export async function fetchTaskRoutingSettings(accessToken: string): Promise<TaskRoutingSettings> {
  const response = await fetch(`${BACKEND_URL}/settings/tasks`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function updateTaskRoutingSetting(
  accessToken: string,
  taskType: string,
  routing: { defaultAssigneeId: string | null } | { assigneeRole: 'admin' },
): Promise<TaskRoutingRule & { can_edit: boolean }> {
  const body =
    'assigneeRole' in routing
      ? { task_type: taskType, assignee_role: routing.assigneeRole }
      : { task_type: taskType, default_assignee_id: routing.defaultAssigneeId };

  const response = await fetch(`${BACKEND_URL}/settings/tasks`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJsonOrThrow(response);
}
