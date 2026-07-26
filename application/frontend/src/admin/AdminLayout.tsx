import { Link, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { to: '/admin', label: 'Clients' },
  { to: '/admin/training', label: 'Training' },
];

// The dashboard shell every other cap-client-lifecycle-001 tracer bullet's
// UI builds into (enrollment, contract lifecycle, export, training, leads).
// Nav gains real links as those screens land -- Clients is the first one
// (tb-client-lifecycle-enrollment-001).
export function AdminLayout() {
  const location = useLocation();
  // Exact match only (unlike BrokerageLayout's prefix-matching isActiveLink) --
  // '/admin' is itself a literal path-prefix of '/admin/training', so prefix
  // matching would highlight Clients and Training simultaneously while on
  // Training (tb-admin-nav-active-link-001).
  const isActiveLink = (to: string) => location.pathname === to;

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
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              aria-current={isActiveLink(link.to) ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
                isActiveLink(link.to) && 'bg-accent text-foreground',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
