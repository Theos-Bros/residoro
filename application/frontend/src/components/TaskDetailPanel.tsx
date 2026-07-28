import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  fetchTask,
  fetchTaskAssignees,
  createTask,
  updateTask,
  deleteTask,
  TASK_STATUSES,
  type Task,
  type TaskAssignee,
  type TaskStatus,
} from '@/lib/tasksApi';
import { FloatingPanel } from '@/components/FloatingPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  session: Session;
  taskId: string | 'new';
  isAdmin: boolean;
  // Pre-filled, non-editable link when opened from a linked record's own
  // detail view (e.g. LeadDetailPanel) -- tb-tasks-crud-001's "linked" flow.
  prefillEntity?: { entityType: string; entityId: string };
  onClose: () => void;
  onSaved: () => void;
};

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

// tb-tasks-crud-001: create + edit a task, standalone or linked. Any tenant
// member can create/reassign/change status; delete is admin-only (matches
// this codebase's admin-only-delete convention, enforced again server-side).
export function TaskDetailPanel({ session, taskId, isAdmin, prefillEntity, onClose, onSaved }: Props) {
  const isNew = taskId === 'new';
  const [task, setTask] = useState<Task | null>(null);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [taskType, setTaskType] = useState('manual');
  const [assigneeId, setAssigneeId] = useState('');
  const [status, setStatus] = useState<TaskStatus>('open');

  useEffect(() => {
    fetchTaskAssignees(session.access_token)
      .then(({ members }) => setAssignees(members))
      .catch((err: Error) => setError(err.message));
  }, [session.access_token]);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    fetchTask(session.access_token, taskId)
      .then((found) => {
        if (cancelled) return;
        setTask(found);
        setTitle(found.title);
        setDescription(found.description ?? '');
        setDueDate(found.due_date ?? '');
        setTaskType(found.task_type);
        setAssigneeId(found.assignee_id ?? '');
        setStatus(found.status);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, isNew, session.access_token]);

  async function handleSave() {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        await createTask(session.access_token, {
          title,
          description: description || undefined,
          due_date: dueDate || undefined,
          task_type: taskType || undefined,
          assignee_id: assigneeId || undefined,
          entity_type: prefillEntity?.entityType,
          entity_id: prefillEntity?.entityId,
        });
      } else {
        await updateTask(session.access_token, taskId, {
          title,
          description: description || null,
          due_date: dueDate || null,
          task_type: taskType,
          assignee_id: assigneeId || null,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(next: TaskStatus) {
    if (isNew) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateTask(session.access_token, taskId, { status: next });
      setTask(updated);
      setStatus(updated.status);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (isNew) return;
    setSaving(true);
    setError(null);
    try {
      await deleteTask(session.access_token, taskId);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const linkedEntity = task ? { entityType: task.entity_type, entityId: task.entity_id } : prefillEntity
    ? { entityType: prefillEntity.entityType, entityId: prefillEntity.entityId }
    : null;

  return (
    <FloatingPanel title={isNew ? 'New Task' : 'Task'} onClose={onClose} className="max-w-lg sm:max-w-xl">
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!loading && (
        <div className="space-y-4">
          {linkedEntity?.entityType && (
            <p className="text-xs text-muted-foreground">
              Linked to: {linkedEntity.entityType} ({linkedEntity.entityId})
            </p>
          )}

          <div className="space-y-1">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <textarea
              className="flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Task type</Label>
              <Input value={taskType} onChange={(e) => setTaskType(e.target.value)} placeholder="manual" />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Assignee</Label>
            <select className={selectClass} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                  {a.handle ? ` (@${a.handle})` : ''}
                </option>
              ))}
            </select>
          </div>

          {!isNew && (
            <div className="space-y-1">
              <Label>Status</Label>
              <select
                className={selectClass}
                value={status}
                onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {isNew ? 'Create Task' : 'Save'}
            </Button>
            {!isNew && isAdmin && (
              <Button size="sm" variant="outline" onClick={handleDelete} disabled={saving}>
                Delete
              </Button>
            )}
          </div>
        </div>
      )}
    </FloatingPanel>
  );
}
