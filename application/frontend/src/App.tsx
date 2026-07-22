import type { Session } from '@supabase/supabase-js';
import { Navigate, Route, Routes } from 'react-router-dom';
import { supabase } from './lib/supabaseClient';
import { useState } from 'react';
import { useSupabaseSession } from './hooks/useSupabaseSession';
import { useOperatorStatus, type OperatorStatus } from './hooks/useOperatorStatus';
import { useWorkspaceStatus } from './hooks/useWorkspaceStatus';
import { exportProperties } from './lib/workspaceApi';
import { AuthPage } from './pages/AuthPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { AdminApp } from './admin/AdminApp';
import { ContractWarningBanner } from './components/ContractWarningBanner';
import { ContractNotificationPanel } from './components/ContractNotificationPanel';

type BrokerageAppProps = {
  session: Session | null;
  loading: boolean;
  operatorStatus: OperatorStatus;
};

// The pre-existing brokerage flow -- an operator session redirects to
// /admin instead of rendering here. Migration used to render inline below
// (MigrationPage) despite that redirect comment claiming operators drove it
// -- they couldn't reach this route at all, and the backend had no way to
// scope a migration to any tenant but the caller's own. Migration now lives
// only in the admin dashboard, tenant-selected by the operator; see
// tb-client-lifecycle-migration-execution-001. session/operatorStatus are
// computed once at the App root (see below) and passed in, rather than each
// route independently re-subscribing -- see useSupabaseSession's comment for
// why.
function BrokerageApp({ session, loading, operatorStatus }: BrokerageAppProps) {
  // Called unconditionally (Rules of Hooks) -- tolerates a null session
  // while loading/redirecting, since the early returns below happen after.
  const { status: workspaceStatus, refetch: refetchWorkspaceStatus } = useWorkspaceStatus(session);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  if (loading || (session && operatorStatus === 'loading')) {
    return null;
  }

  if (!session) {
    return <AuthPage />;
  }

  if (operatorStatus === 'operator') {
    return <Navigate to="/admin" replace />;
  }

  // tb-client-lifecycle-export-001: available whenever the session/backend
  // calls succeed at all -- 'blocked' workspaces already fail every
  // requireAuth-gated call (including this one), so no extra access_state
  // check is needed here; the button just reflects whatever state is real.
  const handleExport = async () => {
    setExportError(null);
    setExporting(true);
    try {
      await exportProperties(session.access_token);
    } catch (err) {
      setExportError((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <header>
        <span>{session.user.email}</span>
        <button onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export My Data'}
        </button>
        {exportError && <span role="alert">{exportError}</span>}
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <ContractWarningBanner status={workspaceStatus} />
      <ContractNotificationPanel
        session={session}
        notifications={workspaceStatus?.notifications ?? []}
        onDismissed={refetchWorkspaceStatus}
      />
    </div>
  );
}

export function App() {
  const { session, loading } = useSupabaseSession();
  const operatorStatus = useOperatorStatus(session);

  return (
    <Routes>
      <Route
        path="/"
        element={<BrokerageApp session={session} loading={loading} operatorStatus={operatorStatus} />}
      />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route
        path="/admin/*"
        element={<AdminApp session={session} loading={loading} operatorStatus={operatorStatus} />}
      />
    </Routes>
  );
}
