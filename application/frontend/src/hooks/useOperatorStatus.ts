import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchWhoami } from '@/lib/adminApi';

export type OperatorStatus = 'loading' | 'operator' | 'not-operator';

// Shared by the root brokerage route (redirect operators to /admin) and
// AdminApp (redirect everyone else away from /admin) -- same async check,
// two different redirect directions.
export function useOperatorStatus(session: Session | null): OperatorStatus {
  const [status, setStatus] = useState<OperatorStatus>('loading');

  useEffect(() => {
    if (!session) {
      setStatus('not-operator');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    fetchWhoami(session.access_token).then((whoami) => {
      if (!cancelled) setStatus(whoami ? 'operator' : 'not-operator');
    });

    return () => {
      cancelled = true;
    };
  }, [session]);

  return status;
}
