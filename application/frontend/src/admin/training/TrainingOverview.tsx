import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchTrainingOverview, updateTrainingStatus, type TrainingSession } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Training</h1>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!error && sessions === null && <p className="text-sm text-muted-foreground">Loading…</p>}

      {sessions?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No training sessions scheduled yet -- set them from a client's row on the Clients page.
        </p>
      )}

      {sessions && sessions.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brokerage</TableHead>
                <TableHead>Session</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.brokerage_name}</TableCell>
                  <TableCell>Session {s.session_number}</TableCell>
                  <TableCell>{s.scheduled_date}</TableCell>
                  <TableCell>
                    {s.overdue ? (
                      <Badge variant="destructive">Overdue</Badge>
                    ) : (
                      <Badge variant="secondary">{STATUS_LABEL[s.status]}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {s.status === 'scheduled' && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleMark(s.id, 'completed')}>
                          Mark completed
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleMark(s.id, 'missed')}>
                          Mark missed
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
