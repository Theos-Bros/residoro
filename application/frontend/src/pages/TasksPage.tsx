import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchTasks, fetchTaskAssignees, type Task, type TaskAssignee, type TaskStatus } from '@/lib/tasksApi';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TaskDetailPanel } from '@/components/TaskDetailPanel';

type Props = {
  session: Session;
};

const STATUS_FILTERS: { value: TaskStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

const selectClass = 'flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

// tb-tasks-crud-001: standalone Tasks page -- a single filterable table
// (status, assignee), matching this codebase's existing list conventions
// (see LeadsPage) rather than a drag-drop kanban board.
export function TasksPage({ session }: Props) {
  const { status: workspaceStatus } = useWorkspaceStatus(session);
  const isAdmin = workspaceStatus?.role === 'admin';

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | 'new' | null>(null);

  function reloadTasks() {
    fetchTasks(session.access_token, {
      status: statusFilter === 'all' ? undefined : statusFilter,
      assignee_id: assigneeFilter || undefined,
    })
      .then(({ tasks }) => setTasks(tasks))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    reloadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token, statusFilter, assigneeFilter]);

  useEffect(() => {
    fetchTaskAssignees(session.access_token)
      .then(({ members }) => setAssignees(members))
      .catch((err: Error) => setError(err.message));
  }, [session.access_token]);

  function assigneeName(id: string | null) {
    if (!id) return '—';
    const found = assignees.find((a) => a.id === id);
    if (!found) return '—';
    return found.full_name || (found.handle ? `@${found.handle}` : '—');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <Button size="sm" onClick={() => setOpenTaskId('new')}>
          New Task
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select className={selectClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TaskStatus | 'all')}>
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select className={selectClass} value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
          <option value="">All assignees</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.full_name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {tasks === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {tasks?.length === 0 && <p className="text-sm text-muted-foreground">No tasks match these filters.</p>}
      {tasks && tasks.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Linked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id} className="cursor-pointer" onClick={() => setOpenTaskId(task.id)}>
                  <TableCell className="font-medium">{task.title}</TableCell>
                  <TableCell>
                    <Badge variant={task.status === 'done' ? 'default' : 'secondary'}>
                      {task.status.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>{assigneeName(task.assignee_id)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {task.due_date ? new Date(task.due_date).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{task.task_type}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {task.entity_type ? task.entity_type.replace(/_/g, ' ') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {openTaskId && (
        <TaskDetailPanel
          session={session}
          taskId={openTaskId}
          isAdmin={isAdmin}
          onClose={() => setOpenTaskId(null)}
          onSaved={reloadTasks}
        />
      )}
    </div>
  );
}
