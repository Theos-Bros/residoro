import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchNotifications, dismissNotification, type Notification } from '@/lib/notificationsApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

// tb-notifications-task-due-reminder-001: cap-notifications-001's TB1 and
// first surface. A single undismissed list, newest-first -- no read/unread
// visual distinction yet, no grouping by type (only one type, 'task_due',
// exists as of this tracer bullet).
export function NotificationsPage({ session }: Props) {
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetchNotifications(session.access_token)
      .then(({ notifications }) => setNotifications(notifications))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token]);

  async function handleDismiss(id: string) {
    await dismissNotification(session.access_token, id);
    load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && notifications === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {notifications?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No notifications right now — you'll see task due-date reminders and other
          time-sensitive alerts here.
        </p>
      )}

      {notifications && notifications.length > 0 && (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              className="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-sm text-muted-foreground">{n.message}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => handleDismiss(n.id)}>
                Dismiss
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
