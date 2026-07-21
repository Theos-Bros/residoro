import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

// Called ONCE at the App root (not per-route) so navigating between the
// brokerage tree and /admin doesn't tear down and recreate this
// subscription -- see App.tsx. `loading` distinguishes "still checking"
// from "checked, no session" so callers don't flash a sign-in page before
// the initial getSession() call resolves.
export function useSupabaseSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return { session, loading };
}
