import { Outlet } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';

// The dashboard shell every other cap-client-lifecycle-001 tracer bullet's
// UI builds into (enrollment, contract lifecycle, export, training, leads).
// Nav is a placeholder -- real links get added as those screens land.
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
          <p className="text-sm font-medium">Dashboard</p>
        </nav>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
