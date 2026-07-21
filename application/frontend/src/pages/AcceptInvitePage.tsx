import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useSupabaseSession } from '@/hooks/useSupabaseSession';
import { Button } from '@/components/ui/button';

// Landing page for an invite email's link (operators today, via
// create-operator.ts; invited brokerage clients later, via
// tb-client-lifecycle-enrollment-001). supabase-js's default
// detectSessionInUrl behavior already establishes a session from the
// invite link's token before this component even renders -- this page's
// only job is collecting a password for that already-signed-in-but-
// password-less account.
export function AcceptInvitePage() {
  const { session, loading } = useSupabaseSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    // Root route redirects operators to /admin automatically once their
    // session + role check resolve (see useOperatorStatus).
    navigate('/', { replace: true });
  }

  if (loading) {
    return null;
  }

  if (!session) {
    return (
      <div className="mx-auto mt-24 max-w-sm text-center text-sm text-muted-foreground">
        <p>This invite link is invalid or has expired. Ask whoever invited you to send a new one.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-24 max-w-sm">
      <h1 className="text-xl font-semibold">Set your password</h1>
      <p className="mt-1 text-sm text-muted-foreground">Signed in as {session.user.email}</p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
          className="w-full rounded-md border border-input px-3 py-2 text-sm"
        />
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Saving…' : 'Set password and continue'}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </div>
  );
}
