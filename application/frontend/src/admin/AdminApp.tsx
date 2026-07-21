import type { Session } from '@supabase/supabase-js';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { OperatorStatus } from '@/hooks/useOperatorStatus';
import { AuthPage } from '@/pages/AuthPage';
import { AdminLayout } from './AdminLayout';
import { AdminHome } from './AdminHome';

type AdminAppProps = {
  session: Session | null;
  loading: boolean;
  operatorStatus: OperatorStatus;
};

// Guards the whole /admin/* tree: unauthenticated -> shared sign-in page;
// authenticated but not an operator -> bounced back to the brokerage app;
// confirmed operator -> the actual dashboard shell + nested routes.
// session/operatorStatus are computed once at the App root and passed in --
// see App.tsx and useSupabaseSession's comment for why this isn't
// re-subscribed per-route.
export function AdminApp({ session, loading, operatorStatus }: AdminAppProps) {
  if (loading || (session && operatorStatus === 'loading')) {
    return null;
  }

  if (!session) {
    return <AuthPage />;
  }

  if (operatorStatus !== 'operator') {
    return <Navigate to="/" replace />;
  }

  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<AdminHome />} />
      </Route>
    </Routes>
  );
}
