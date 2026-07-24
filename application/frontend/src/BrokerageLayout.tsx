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
import { Button } from './components/ui/button';

type Props = {
  session: Session | null;
  loading: boolean;
  operatorStatus: OperatorStatus;
};

// tb-listings-create-001: factors BrokerageApp's session/operator gating and
// header (previously the entire "/" route body) into a layout with <Outlet/>
// so /properties and its sibling routes can share it, mirroring AdminLayout's
// shape. The header/banner/panel now render on every brokerage route, not
// just "/", since they're workspace-wide state, not page content.
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
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
          <nav className="flex items-center gap-4">
            <Link to="/properties" className="text-sm font-semibold tracking-tight">
              Residoro
            </Link>
            <Link to="/properties" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Properties
            </Link>
            <Link to="/shared-with-me" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Shared with me
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">{session.user.email}</span>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export My Data'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
              Sign out
            </Button>
          </div>
        </div>
        {exportError && (
          <p role="alert" className="mx-auto max-w-6xl px-4 pb-2 text-sm text-destructive sm:px-6">
            {exportError}
          </p>
        )}
      </header>
      <ContractWarningBanner status={workspaceStatus} />
      <ContractNotificationPanel
        session={session}
        notifications={workspaceStatus?.notifications ?? []}
        onDismissed={refetchWorkspaceStatus}
      />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
