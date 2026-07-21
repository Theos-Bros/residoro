import { Navigate, Route, Routes } from 'react-router-dom';
import { useSupabaseSession } from '@/hooks/useSupabaseSession';
import { useOperatorStatus } from '@/hooks/useOperatorStatus';
import { AuthPage } from '@/pages/AuthPage';
import { AdminLayout } from './AdminLayout';
import { AdminHome } from './AdminHome';

// Guards the whole /admin/* tree: unauthenticated -> shared sign-in page;
// authenticated but not an operator -> bounced back to the brokerage app;
// confirmed operator -> the actual dashboard shell + nested routes.
export function AdminApp() {
  const { session, loading } = useSupabaseSession();
  const operatorStatus = useOperatorStatus(session);

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
