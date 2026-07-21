import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchWhoami } from '@/lib/adminApi';

export type OperatorStatus = 'loading' | 'operator' | 'not-operator';

// Called ONCE at the App root, alongside useSupabaseSession -- see App.tsx.
// Depends on the access_token *string*, not the session object reference:
// Supabase fires onAuthStateChange with a new session object (same token)
// on every subscribe (e.g. an INITIAL_SESSION event), which would otherwise
// needlessly reset this back to 'loading' and refetch.
export function useOperatorStatus(session: Session | null): OperatorStatus {
  const [status, setStatus] = useState<OperatorStatus>('loading');
  const accessToken = session?.access_token;

  useEffect(() => {
    if (!accessToken) {
      setStatus('not-operator');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    fetchWhoami(accessToken).then((whoami) => {
      if (!cancelled) setStatus(whoami ? 'operator' : 'not-operator');
    });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return status;
}
