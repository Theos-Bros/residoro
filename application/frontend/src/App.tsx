import type { Session } from '@supabase/supabase-js';
import { Navigate, Route, Routes } from 'react-router-dom';
import { supabase } from './lib/supabaseClient';
import { useSupabaseSession } from './hooks/useSupabaseSession';
import { useOperatorStatus, type OperatorStatus } from './hooks/useOperatorStatus';
import { AuthPage } from './pages/AuthPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { MigrationPage } from './pages/MigrationPage';
import { AdminApp } from './admin/AdminApp';

type BrokerageAppProps = {
  session: Session | null;
  loading: boolean;
  operatorStatus: OperatorStatus;
};

// The pre-existing brokerage flow, unchanged behavior-wise -- just now aware
// that an operator session should redirect to /admin instead of rendering
// MigrationPage (operators never touch this flow directly, per
// cap-client-lifecycle-001). session/operatorStatus are computed once at
// the App root (see below) and passed in, rather than each route
// independently re-subscribing -- see useSupabaseSession's comment for why.
function BrokerageApp({ session, loading, operatorStatus }: BrokerageAppProps) {
  if (loading || (session && operatorStatus === 'loading')) {
    return null;
  }

  if (!session) {
    return <AuthPage />;
  }

  if (operatorStatus === 'operator') {
    return <Navigate to="/admin" replace />;
  }

  return (
    <div>
      <header>
        <span>{session.user.email}</span>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <MigrationPage session={session} />
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
