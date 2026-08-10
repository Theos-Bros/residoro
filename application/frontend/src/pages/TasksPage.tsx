import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  fetchTasks,
  fetchTaskAssignees,
  fetchTaskRoutingSettings,
  createTask,
  updateTask,
  TASK_ENTITY_ROUTE,
  type Task,
  type TaskAssignee,
  type TaskStatus,
} from '@/lib/tasksApi';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TaskDetailPanel } from '@/components/TaskDetailPanel';
import { useHighlightFromSearch } from '@/hooks/useHighlightFromSearch';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

type Props = {
  session: Session;
};

const STATUS_FILTERS: { value: TaskStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

const selectClass =
  'flex h-9 rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground shadow-sm';

// Residoro Design Language (2026-08-03), section 09 "TasksPage": a queue
// grouped by due bucket rather than a flat table -- the doc's three buckets
// (Overdue/Today/This week) plus two this codebase actually needs to avoid
// silently dropping data the old flat table always showed: 'later' (no due
// date, or due beyond this week) and 'done' (completed tasks -- the doc's
// mock is queue-only and doesn't model them, but the existing status filter
// already lets a member view completed tasks, so they still need a home).
type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'done';

const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'week', 'later', 'done'];

const BUCKET_META: Record<Bucket, { label: string; accentClass: string }> = {
  overdue: { label: 'Overdue', accentClass: 'text-destructive' },
  today: { label: 'Today', accentClass: 'text-primary' },
  week: { label: 'This week', accentClass: 'text-tertiary-foreground' },
  later: { label: 'Later', accentClass: 'text-tertiary-foreground' },
  done: { label: 'Completed', accentClass: 'text-muted-foreground' },
};

// due_date is a plain 'YYYY-MM-DD' string (HTML date-input value, see
// TaskDetailPanel) with no time/timezone component -- comparing it against a
// same-shaped *local* calendar-day string (not `new Date().toISOString()`,
// which is UTC and can land on the wrong day) keeps "Today" meaning the
// user's today, and lets bucket math use plain string comparison since
// ISO-shaped dates sort lexicographically.
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function bucketOf(task: Task, todayStr: string, weekEndStr: string): Bucket {
  if (task.status === 'done') return 'done';
  if (!task.due_date) return 'later';
  if (task.due_date < todayStr) return 'overdue';
  if (task.due_date === todayStr) return 'today';
  if (task.due_date <= weekEndStr) return 'week';
  return 'later';
}

// Real urgency, not a hardcoded color per bucket -- a task can only be
// 'overdue' if it's still open, so this and bucketOf agree by construction.
function dueColorClass(task: Task, todayStr: string): string {
  if (task.status === 'done') return 'text-muted-foreground';
  if (!task.due_date) return 'text-tertiary-foreground';
  if (task.due_date < todayStr) return 'text-destructive';
  if (task.due_date === todayStr) return 'text-primary';
  return 'text-tertiary-foreground';
}

function dueLabel(task: Task, bucket: Bucket): string {
  if (!task.due_date) return bucket === 'done' ? 'Done' : 'No due date';
  if (bucket === 'today') return 'Today';
  return parseDateOnly(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// tb-tasks-crud-001: standalone Tasks page -- a queue across leads,
// properties and clients (see LeadsPage), not a drag-drop kanban board.
// Residoro Design Language (2026-08-03): restyled per the design doc's
// TasksPage mock -- grouped-by-due-bucket queue + a right rail. The mock's
// right-rail "Add a task" card assumes a record-search combobox (search
// contacts/leads/listings/properties inline and link one to the new task);
// no such search API exists anywhere in this app today, and building one is
// new functionality far outside a restyle's scope. What's real here instead:
// the pill row selects from this tenant's actual configured task_types (see
// fetchTaskRoutingSettings / TaskRoutingSettingsPanel) rather than the mock's
// placeholder Contact/Lead/Listing/Property categories, the quick-add card
// creates simple unlinked ("General") tasks directly via the existing
// createTask API, and a link inside the card opens the pre-existing "New
// Task" panel -- completely unchanged -- for anyone who needs the full form
// (description, assignee, or a record link set from that record's own detail
// view via prefillEntity).
export function TasksPage({ session }: Props) {
  const { status: workspaceStatus } = useWorkspaceStatus(session);
  const isAdmin = workspaceStatus?.role === 'admin';

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [taskTypes, setTaskTypes] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | 'new' | null>(null);
  const { highlightedId, clearHighlight } = useHighlightFromSearch(tasks !== null);

  const [quickTitle, setQuickTitle] = useState('');
  const [quickTaskType, setQuickTaskType] = useState('');
  const [quickDueDate, setQuickDueDate] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

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

  // Best-effort, same non-critical fetch pattern as SearchPage's matching
  // settings -- if this fails, the quick-add pill row just doesn't render.
  useEffect(() => {
    fetchTaskRoutingSettings(session.access_token)
      .then((settings) => setTaskTypes(settings.task_types))
      .catch(() => {});
  }, [session.access_token]);

  function assigneeName(id: string | null) {
    if (!id) return '—';
    const found = assignees.find((a) => a.id === id);
    if (!found) return '—';
    return found.full_name || (found.handle ? `@${found.handle}` : '—');
  }

  const todayStr = localDateStr(new Date());
  const weekEndStr = localDateStr(new Date(Date.now() + 6 * 86400000));

  const grouped = useMemo(() => {
    const map: Record<Bucket, Task[]> = { overdue: [], today: [], week: [], later: [], done: [] };
    for (const task of tasks ?? []) {
      map[bucketOf(task, todayStr, weekEndStr)].push(task);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, todayStr, weekEndStr]);

  // Real counts off the same `tasks` state the queue below renders from (no
  // second endpoint) -- so, like the queue itself, these reflect whatever
  // status/assignee filters are currently active.
  const summary = useMemo(() => {
    const all = tasks ?? [];
    const sevenDaysAgoStr = localDateStr(new Date(Date.now() - 6 * 86400000));
    const completedThisWeek = all.filter((t) => t.status === 'done' && t.updated_at.slice(0, 10) >= sevenDaysAgoStr).length;
    const unassigned = all.filter((t) => t.status !== 'done' && !t.assignee_id).length;
    return { completedThisWeek, overdue: grouped.overdue.length, unassigned };
  }, [tasks, grouped]);

  async function handleToggleDone(task: Task) {
    const nextStatus: TaskStatus = task.status === 'done' ? 'open' : 'done';
    setError(null);
    try {
      await updateTask(session.access_token, task.id, { status: nextStatus });
      reloadTasks();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleQuickAdd() {
    if (!quickTitle.trim()) {
      setQuickError('Title is required');
      return;
    }
    setQuickSaving(true);
    setQuickError(null);
    try {
      await createTask(session.access_token, {
        title: quickTitle.trim(),
        task_type: quickTaskType || undefined,
        due_date: quickDueDate || undefined,
      });
      setQuickTitle('');
      setQuickDueDate('');
      reloadTasks();
    } catch (err) {
      setQuickError((err as Error).message);
    } finally {
      setQuickSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Your follow-ups across leads, properties and clients in one queue. Completing a task here also
            stamps the activity log on whichever record it came from.
          </p>
        </div>
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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
          <div className="flex flex-col gap-5">
            {BUCKET_ORDER.filter((bucket) => grouped[bucket].length > 0).map((bucket) => (
              <div key={bucket} className="flex flex-col gap-2">
                <div className="flex items-center gap-2.5">
                  <span className={cn('text-[13px] font-semibold', BUCKET_META[bucket].accentClass)}>
                    {BUCKET_META[bucket].label}
                  </span>
                  <span className="font-mono text-xs text-tertiary-foreground">{grouped[bucket].length}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="overflow-hidden rounded-xl border bg-card">
                  <div className="overflow-x-auto">
                    {grouped[bucket].map((task, i) => {
                      const done = task.status === 'done';
                      return (
                        <div
                          key={task.id}
                          data-row-id={task.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            clearHighlight();
                            setOpenTaskId(task.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              clearHighlight();
                              setOpenTaskId(task.id);
                            }
                          }}
                          className={cn(
                            'grid min-w-[560px] cursor-pointer grid-cols-[28px_1fr_1.1fr_110px_130px] items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/60',
                            i < grouped[bucket].length - 1 && 'border-b border-border/70',
                            highlightedId === task.id && 'bg-amber-100',
                          )}
                        >
                          <button
                            type="button"
                            aria-label={done ? 'Mark task as open' : 'Mark task as done'}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleDone(task);
                            }}
                            className={cn(
                              'flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                              done ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card hover:border-primary/60',
                            )}
                          >
                            {done && <Check className="h-3 w-3" strokeWidth={3} />}
                          </button>
                          <span className={cn('truncate text-sm font-medium text-foreground', done && 'text-muted-foreground line-through')}>
                            {task.title}
                          </span>
                          <span className="truncate text-[13px] text-accent-foreground">
                            {task.entity_type && task.entity_name ? (
                              <Link
                                to={TASK_ENTITY_ROUTE[task.entity_type] ?? '/tasks'}
                                state={{ openId: task.entity_id }}
                                onClick={(e) => e.stopPropagation()}
                                className="hover:underline"
                              >
                                {task.entity_name}
                              </Link>
                            ) : task.entity_type ? (
                              task.entity_type.replace(/_/g, ' ')
                            ) : (
                              'General'
                            )}
                          </span>
                          <span className="truncate text-[13px] text-muted-foreground">{assigneeName(task.assignee_id)}</span>
                          <span className={cn('text-right text-[13px] font-medium', dueColorClass(task, todayStr))}>
                            {dueLabel(task, bucket)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
              <span className="font-mono text-[11px] uppercase tracking-widest text-tertiary-foreground">This week</span>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Completed</span>
                <span className="font-mono font-medium text-foreground">{summary.completedThisWeek}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Overdue</span>
                <span className="font-mono font-medium text-destructive">{summary.overdue}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Unassigned</span>
                <span className="font-mono font-medium text-foreground">{summary.unassigned}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-4">
              <span className="font-mono text-[11px] uppercase tracking-widest text-tertiary-foreground">Add a task</span>
              <Input
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleQuickAdd();
                }}
                placeholder="What needs doing?"
                aria-label="New task title"
                className="h-9 text-sm"
              />
              {taskTypes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {taskTypes.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setQuickTaskType(quickTaskType === type ? '' : type)}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                        quickTaskType === type
                          ? 'border-[#EFE4C8] bg-accent text-accent-foreground dark:border-[#4A3D1D]'
                          : 'border-border bg-card text-muted-foreground hover:bg-secondary',
                      )}
                    >
                      {type.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-tertiary-foreground">
                Optional — unlinked tasks show under &quot;General&quot;. Need to link this to a lead, property or
                contact?{' '}
                <button
                  type="button"
                  onClick={() => setOpenTaskId('new')}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Use the full form
                </button>
                .
              </p>
              <div className="flex flex-col gap-1">
                <Label htmlFor="quick-task-due" className="text-xs font-normal text-muted-foreground">
                  Due
                </Label>
                <Input
                  id="quick-task-due"
                  type="date"
                  value={quickDueDate}
                  onChange={(e) => setQuickDueDate(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              {quickError && (
                <p role="alert" className="text-xs text-destructive">
                  {quickError}
                </p>
              )}
              <Button size="sm" onClick={handleQuickAdd} disabled={quickSaving} className="w-full">
                {quickSaving ? 'Adding…' : 'Add task'}
              </Button>
            </div>
          </div>
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
