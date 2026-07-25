import { Link, Outlet } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';

// The dashboard shell every other cap-client-lifecycle-001 tracer bullet's
// UI builds into (enrollment, contract lifecycle, export, training, leads).
// Nav gains real links as those screens land -- Clients is the first one
// (tb-client-lifecycle-enrollment-001).
export function AdminLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-background">
        <div className="flex h-14 items-center justify-between px-6">
          <span className="text-sm font-semibold tracking-tight">Residoro Admin</span>
          <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <div className="flex flex-1">
        <nav className="flex w-56 flex-col gap-1 border-r p-4">
          <Link
            to="/admin"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Clients
          </Link>
          <Link
            to="/admin/training"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Training
          </Link>
        </nav>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
