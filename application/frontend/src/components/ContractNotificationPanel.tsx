import type { Session } from '@supabase/supabase-js';
import { dismissNotification } from '@/lib/workspaceApi';
import type { ContractNotification } from '@/lib/workspaceApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
  notifications: ContractNotification[];
  onDismissed: () => void;
};

// Side-panel notification list -- persists until dismissed or the
// underlying state changes (the latter is handled server-side: the daily
// Edge Function auto-dismisses stale notifications on renewal).
export function ContractNotificationPanel({ session, notifications, onDismissed }: Props) {
  if (notifications.length === 0) return null;

  async function handleDismiss(id: string) {
    await dismissNotification(session.access_token, id);
    onDismissed();
  }

  return (
    <aside className="mx-auto my-3 max-w-6xl rounded-md border bg-card px-4 py-3 sm:mx-6 sm:px-6">
      <p className="mb-2 text-sm font-semibold">Contract notifications</p>
      <ul className="space-y-1">
        {notifications.map((n) => (
          <li key={n.id} className="flex items-center justify-between gap-3 text-sm">
            <span>{n.message}</span>
            <Button size="sm" variant="ghost" onClick={() => handleDismiss(n.id)}>
              Dismiss
            </Button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
