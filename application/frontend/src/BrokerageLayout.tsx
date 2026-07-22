import type { Session } from '@supabase/supabase-js';
import { Link, Navigate, Outlet } from 'react-router-dom';
import { supabase } from './lib/supabaseClient';
import { useState } from 'react';
import type { OperatorStatus } from './hooks/useOperatorStatus';
import { useWorkspaceStatus } from './hooks/useWorkspaceStatus';
import { exportData } from './lib/workspaceApi';
import { AuthPage } from './pages/AuthPage';
import { ContractWarningBanner } from './components/ContractWarningBanner';
import { ContractNotificationPanel } from './components/ContractNotificationPanel';

type Props = {
  session: Session | null;
  loading: boolean;
  operatorStatus: OperatorStatus;
};

// tb-listings-create-001: factors BrokerageApp's session/operator gating and
// header (previously the entire "/" route body) into a layout with <Outlet/>
// so /properties and /properties/:id/listings/new can share it, mirroring
// AdminLayout's shape. The header/banner/panel now render on every brokerage
// route, not just "/", since they're workspace-wide state, not page content.
export function BrokerageLayout({ session, loading, operatorStatus }: Props) {
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

  const handleExport = async () => {
    setExportError(null);
    setExporting(true);
    try {
      await exportData(session.access_token);
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
        <Link to="/properties">Properties</Link>
        <Link to="/shared-with-me">Shared with me</Link>
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
      <Outlet />
    </div>
  );
}
