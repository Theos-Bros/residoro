import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchViewings, type Viewing } from '@/lib/viewingsApi';
import { fetchTasks, type Task } from '@/lib/tasksApi';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TaskDetailPanel } from '@/components/TaskDetailPanel';
import { cn } from '@/lib/utils';

type Props = {
  session: Session;
};

// tb-calendar-schedule-001: confirmed with the user 2026-08-04 -- "Follow-Up
// Schedules" is a filtered slice of Tasks, not a new entity. These are
// exactly the 3 stage-change-generated task_types whose STAGE_TASK_TITLES
// (stageTaskGeneration.ts, backend) read "Follow up...".
const FOLLOW_UP_TASK_TYPES = new Set(['stage_registered', 'stage_options_sent', 'stage_negotiating']);

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Same local-date-string pattern as TasksPage.tsx -- plain 'YYYY-MM-DD'
// string comparison avoids UTC-vs-local day mismatches.
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type DayEvent =
  | { kind: 'viewing'; id: string; time: string; label: string; viewing: Viewing }
  | { kind: 'followup' | 'deadline'; id: string; time: string; label: string; task: Task };

export function CalendarPage({ session }: Props) {
  const navigate = useNavigate();
  const { status: workspaceStatus } = useWorkspaceStatus(session);
  const isAdmin = workspaceStatus?.role === 'admin';

  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | 'new' | null>(null);

  const [showViewings, setShowViewings] = useState(true);
  const [showFollowUps, setShowFollowUps] = useState(true);
  const [showDeadlines, setShowDeadlines] = useState(true);

  useEffect(() => {
    fetchViewings(session.access_token)
      .then(({ viewings }) => setViewings(viewings))
      .catch((err: Error) => setError(err.message));
    fetchTasks(session.access_token)
      .then(({ tasks }) => setTasks(tasks))
      .catch((err: Error) => setError(err.message));
  }, [session.access_token]);

  // Sun-Sat grid padded out to full weeks around the current month --
  // deliberately the smallest real calendar grid (no external library), per
  // this tracer bullet's own scoping.
  const gridDays = useMemo(() => {
    const monthStart = monthCursor;
    const monthEnd = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
    const gridStart = new Date(monthStart);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    const gridEnd = new Date(monthEnd);
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

    const days: Date[] = [];
    for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d));
    }
    return days;
  }, [monthCursor]);

  // Deliberate overlap: a follow-up task appears under both 'followup' and
  // 'deadline' when both filters are on -- see cap-calendar-001's Key Design
  // Decisions ("Task Deadlines and Follow-Ups deliberately overlap").
  const eventsByDate = useMemo(() => {
    const map = new Map<string, DayEvent[]>();
    function push(dateKey: string, event: DayEvent) {
      const list = map.get(dateKey) ?? [];
      list.push(event);
      map.set(dateKey, list);
    }

    for (const viewing of viewings) {
      const dt = new Date(viewing.scheduled_at);
      const dateKey = localDateStr(dt);
      const label = `${viewing.listings?.properties?.title ?? 'Listing'} — ${viewing.buyer_requirements?.contacts?.name ?? 'Lead'}`;
      push(dateKey, {
        kind: 'viewing',
        id: viewing.id,
        time: dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
        label,
        viewing,
      });
    }

    for (const task of tasks) {
      if (!task.due_date) continue;
      const dateKey = task.due_date;
      if (FOLLOW_UP_TASK_TYPES.has(task.task_type)) {
        push(dateKey, { kind: 'followup', id: `${task.id}-followup`, time: '', label: task.title, task });
      }
      push(dateKey, { kind: 'deadline', id: `${task.id}-deadline`, time: '', label: task.title, task });
    }

    return map;
  }, [viewings, tasks]);

  function visibleEvents(dateKey: string): DayEvent[] {
    const all = eventsByDate.get(dateKey) ?? [];
    return all.filter(
      (e) =>
        (e.kind === 'viewing' && showViewings) ||
        (e.kind === 'followup' && showFollowUps) ||
        (e.kind === 'deadline' && showDeadlines),
    );
  }

  function handleEventClick(event: DayEvent) {
    if (event.kind === 'viewing') {
      navigate('/leads', { state: { openLeadId: event.viewing.buyer_requirement_id } });
    } else {
      setOpenTaskId(event.task.id);
    }
  }

  const todayStr = localDateStr(new Date());
  const monthLabel = monthCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Every scheduled viewing, follow-up, and task deadline across the brokerage, in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
          >
            Prev
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const now = new Date();
              setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            Today
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
          >
            Next
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <span className="text-lg font-medium">{monthLabel}</span>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showViewings} onChange={(e) => setShowViewings(e.target.checked)} />
            <Badge variant="warning">Viewing Schedules</Badge>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showFollowUps} onChange={(e) => setShowFollowUps(e.target.checked)} />
            <Badge variant="success">Follow-Up Schedules</Badge>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showDeadlines} onChange={(e) => setShowDeadlines(e.target.checked)} />
            <Badge variant="neutral">Task Deadlines</Badge>
          </label>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-7 border-b bg-secondary">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="px-2 py-2 text-center font-mono text-[11px] uppercase tracking-wider text-tertiary-foreground">
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {gridDays.map((day) => {
            const dateKey = localDateStr(day);
            const inMonth = day.getMonth() === monthCursor.getMonth();
            const events = visibleEvents(dateKey);
            const isToday = dateKey === todayStr;
            return (
              <div
                key={dateKey}
                className={cn(
                  'min-h-28 border-b border-r p-1.5 last:border-r-0',
                  !inMonth && 'bg-secondary/40 text-tertiary-foreground',
                )}
              >
                <div
                  className={cn(
                    'mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                    isToday && 'bg-primary text-primary-foreground',
                  )}
                >
                  {day.getDate()}
                </div>
                <div className="space-y-1">
                  {events.slice(0, 3).map((event) => (
                    <Badge
                      key={event.id}
                      variant={event.kind === 'viewing' ? 'warning' : event.kind === 'followup' ? 'success' : 'neutral'}
                      className="block w-full cursor-pointer truncate text-left"
                      onClick={() => handleEventClick(event)}
                      title={event.label}
                    >
                      {event.time ? `${event.time} ` : ''}
                      {event.label}
                    </Badge>
                  ))}
                  {events.length > 3 && (
                    <p className="px-1 text-[11px] text-tertiary-foreground">+{events.length - 3} more</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {openTaskId && (
        <TaskDetailPanel
          session={session}
          taskId={openTaskId}
          isAdmin={isAdmin}
          onClose={() => setOpenTaskId(null)}
          onSaved={() => {
            fetchTasks(session.access_token)
              .then(({ tasks }) => setTasks(tasks))
              .catch((err: Error) => setError(err.message));
          }}
        />
      )}
    </div>
  );
}
