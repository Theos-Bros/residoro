import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchTrainingOverview, updateTrainingStatus, type TrainingSession } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

const STATUS_LABEL: Record<TrainingSession['status'], string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  missed: 'Missed',
};

// tb-client-lifecycle-training-001: cross-client view of every training
// session so an operator doesn't rely on memory or a personal calendar --
// overdue sessions (still 'scheduled' but the date has passed) are called
// out inline rather than needing a separate filtered screen.
export function TrainingOverview({ session }: Props) {
  const [sessions, setSessions] = useState<TrainingSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    fetchTrainingOverview(session.access_token)
      .then(({ sessions }) => setSessions(sessions))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    let cancelled = false;

    fetchTrainingOverview(session.access_token)
      .then(({ sessions }) => {
        if (!cancelled) setSessions(sessions);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [session.access_token]);

  async function handleMark(sessionId: string, status: 'completed' | 'missed') {
    try {
      await updateTrainingStatus(session.access_token, sessionId, status);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Training</h1>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {!error && sessions === null && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}

      {sessions?.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          No training sessions scheduled yet -- set them from a client's row on the Clients page.
        </p>
      )}

      {sessions && sessions.length > 0 && (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4 font-medium">Brokerage</th>
              <th className="py-2 pr-4 font-medium">Session</th>
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-b">
                <td className="py-2 pr-4">{s.brokerage_name}</td>
                <td className="py-2 pr-4">Session {s.session_number}</td>
                <td className="py-2 pr-4">{s.scheduled_date}</td>
                <td className="py-2 pr-4">
                  {s.overdue ? <span className="text-destructive">Overdue</span> : STATUS_LABEL[s.status]}
                </td>
                <td className="py-2 pr-4">
                  {s.status === 'scheduled' && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleMark(s.id, 'completed')}>
                        Mark completed
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleMark(s.id, 'missed')}>
                        Mark missed
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
