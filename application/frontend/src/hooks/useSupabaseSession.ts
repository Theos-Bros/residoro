import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

// Extracted out of App.tsx so both the brokerage-facing tree and the new
// /admin tree can watch the same session without duplicating this
// useState/useEffect pair. `loading` distinguishes "still checking" from
// "checked, no session" so callers don't flash a sign-in page before the
// initial getSession() call resolves.
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
