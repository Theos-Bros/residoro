import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { scheduleTraining } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  session: Session;
};

// tb-client-lifecycle-training-001: records/reschedules a client's two
// training session dates. tenantId comes from the route, same pattern as
// ClientMigration -- the client the operator picked in ClientList.
export function TrainingScheduleForm({ session }: Props) {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [session1Date, setSession1Date] = useState('');
  const [session2Date, setSession2Date] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (session2Date && session1Date && session2Date <= session1Date) {
      setError('Session 2 date must be after the session 1 date.');
      return;
    }

    setSubmitting(true);
    try {
      await scheduleTraining(session.access_token, tenantId!, session1Date, session2Date);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Schedule training</h1>
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="session_1_date">Session 1 date</Label>
              <Input
                id="session_1_date"
                type="date"
                value={session1Date}
                onChange={(e) => setSession1Date(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="session_2_date">Session 2 date</Label>
              <Input
                id="session_2_date"
                type="date"
                value={session2Date}
                onChange={(e) => setSession2Date(e.target.value)}
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save training dates'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
