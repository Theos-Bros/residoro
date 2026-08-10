import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  fetchTaskRoutingSettings,
  fetchTaskAssignees,
  updateTaskRoutingSetting,
  type TaskAssignee,
} from '@/lib/tasksApi';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toSentenceCase } from '@/lib/utils';

type Props = {
  session: Session;
};

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

// tb-buyer-leads-stage-tasks-001: a sentinel option in the same dropdown,
// alongside "Unassigned" and each specific person -- routes to whoever holds
// the tenant's admin role (assignee_role='admin') rather than one hardcoded
// person. Encoded as a value the select's onChange can distinguish from a
// real assignee id.
const ADMIN_ROLE_VALUE = '__admin__';

// tb-tasks-crud-001: Settings' "Tasks" sub-section -- one row per known
// task_type (in use, or already routed) with a default-assignee picker,
// following MatchingSettingsPanel/PerformanceSettingsPanel's exact
// view-all/edit-gated shape. task_type is open text (cap-tasks-001), so an
// admin/delegated member can also add a routing rule for a task_type not yet
// used by any existing task.
export function TaskRoutingSettingsPanel({ session }: Props) {
  const [taskTypes, setTaskTypes] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [newTaskType, setNewTaskType] = useState('');
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    Promise.all([fetchTaskRoutingSettings(session.access_token), fetchTaskAssignees(session.access_token)])
      .then(([settings, assigneesResult]) => {
        setTaskTypes(settings.task_types);
        setDefaults(
          Object.fromEntries(
            settings.routing_rules.map((r) => [
              r.task_type,
              r.assignee_role === 'admin' ? ADMIN_ROLE_VALUE : (r.default_assignee_id ?? ''),
            ]),
          ),
        );
        setCanEdit(settings.can_edit);
        setAssignees(assigneesResult.members);
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reload, [session.access_token]);

  async function handleChange(taskType: string, value: string) {
    setError(null);
    setPendingKey(taskType);
    try {
      await updateTaskRoutingSetting(
        session.access_token,
        taskType,
        value === ADMIN_ROLE_VALUE ? { assigneeRole: 'admin' } : { defaultAssigneeId: value || null },
      );
      setDefaults((prev) => ({ ...prev, [taskType]: value }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPendingKey(null);
    }
  }

  async function handleAddTaskType() {
    const trimmed = newTaskType.trim();
    if (!trimmed) return;
    if (taskTypes.includes(trimmed)) {
      setNewTaskType('');
      return;
    }
    setError(null);
    setPendingKey(trimmed);
    try {
      await updateTaskRoutingSetting(session.access_token, trimmed, { defaultAssigneeId: null });
      setTaskTypes((prev) => [...prev, trimmed].sort());
      setDefaults((prev) => ({ ...prev, [trimmed]: '' }));
      setNewTaskType('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Tasks</h2>
        <p className="text-sm text-muted-foreground">
          Set a default assignee per task type. A task created with no explicit assignee falls back to this default;
          one with no rule is created unassigned.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {loaded && !canEdit && (
        <p className="text-sm text-muted-foreground">
          Only an admin, or a member granted edit access, can edit task routing.
        </p>
      )}

      {!loaded && <p className="text-sm text-muted-foreground">Loading…</p>}

      {loaded && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task type</TableHead>
                <TableHead>Default assignee</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {taskTypes.map((taskType) => (
                <TableRow key={taskType}>
                  <TableCell className="font-medium">{toSentenceCase(taskType)}</TableCell>
                  <TableCell>
                    <select
                      className={selectClass}
                      value={defaults[taskType] ?? ''}
                      disabled={!canEdit || pendingKey === taskType}
                      onChange={(e) => handleChange(taskType, e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      <option value={ADMIN_ROLE_VALUE}>The tenant's admin</option>
                      {assignees.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.full_name}
                          {a.handle ? ` (@${a.handle})` : ''}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {loaded && canEdit && (
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Add task type</label>
            <Input
              value={newTaskType}
              onChange={(e) => setNewTaskType(e.target.value)}
              placeholder="e.g. stage_change"
              className="w-48"
            />
          </div>
          <Button size="sm" variant="outline" onClick={handleAddTaskType} disabled={!newTaskType.trim()}>
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
