import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { scheduleTraining } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

const inputClass = 'w-full rounded-md border border-input px-3 py-2 text-sm';

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
    <div className="max-w-md">
      <h1 className="text-2xl font-semibold">Schedule training</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="session_1_date" className="text-sm font-medium">
            Session 1 date
          </label>
          <input
            id="session_1_date"
            type="date"
            value={session1Date}
            onChange={(e) => setSession1Date(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="session_2_date" className="text-sm font-medium">
            Session 2 date
          </label>
          <input
            id="session_2_date"
            type="date"
            value={session2Date}
            onChange={(e) => setSession2Date(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save training dates'}
        </Button>
      </form>
    </div>
  );
}
