import { Link, Outlet } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';

// The dashboard shell every other cap-client-lifecycle-001 tracer bullet's
// UI builds into (enrollment, contract lifecycle, export, training, leads).
// Nav gains real links as those screens land -- Clients is the first one
// (tb-client-lifecycle-enrollment-001).
export function AdminLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="text-lg font-semibold">Residoro Admin</span>
        <Button variant="outline" size="sm" onClick={() => supabase.auth.signOut()}>
          Sign out
        </Button>
      </header>
      <div className="flex flex-1">
        <nav className="w-56 border-r p-4">
          <Link to="/admin" className="text-sm font-medium">
            Clients
          </Link>
        </nav>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
