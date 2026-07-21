import type { Session } from '@supabase/supabase-js';
import { dismissNotification } from '@/lib/workspaceApi';
import type { ContractNotification } from '@/lib/workspaceApi';

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
    <aside style={{ border: '1px solid #ddd', padding: '12px 16px', margin: '12px 0', maxWidth: 420 }}>
      <p style={{ fontWeight: 600, margin: '0 0 8px' }}>Contract notifications</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {notifications.map((n) => (
          <li key={n.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0' }}>
            <span>{n.message}</span>
            <button onClick={() => handleDismiss(n.id)}>Dismiss</button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
