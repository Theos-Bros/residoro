import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchWorkspaceStatus, type WorkspaceStatus } from '@/lib/workspaceApi';

// Called once at the brokerage app root (App.tsx), alongside
// useOperatorStatus -- operators skip this entirely since they aren't
// tenant-scoped (see requireAuth's accessState, which only applies to
// tenant-scoped requests). Refetch is exposed so a dismiss action can
// immediately reflect in the panel without waiting for the next poll.
export function useWorkspaceStatus(session: Session | null) {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const accessToken = session?.access_token;

  const refetch = useCallback(() => {
    if (!accessToken) return;
    fetchWorkspaceStatus(accessToken).then(setStatus).catch(() => setStatus(null));
  }, [accessToken]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { status, refetch };
}
