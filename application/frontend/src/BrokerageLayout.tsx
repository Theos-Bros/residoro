import type { Session } from '@supabase/supabase-js';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabaseClient';
import { useState } from 'react';
import { Menu } from 'lucide-react';
import type { OperatorStatus } from './hooks/useOperatorStatus';
import { useWorkspaceStatus } from './hooks/useWorkspaceStatus';
import { exportData } from './lib/workspaceApi';
import { AuthPage } from './pages/AuthPage';
import { ContractWarningBanner } from './components/ContractWarningBanner';
import { ContractNotificationPanel } from './components/ContractNotificationPanel';
import { Button } from './components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from './components/ui/sheet';
import { cn } from './lib/utils';

type Props = {
  session: Session | null;
  loading: boolean;
  operatorStatus: OperatorStatus;
};

const NAV_LINKS = [
  { to: '/properties', label: 'Properties' },
  { to: '/projects', label: 'Projects' },
  { to: '/listings', label: 'Listings' },
  { to: '/leads', label: 'Leads' },
  { to: '/search', label: 'Search' },
  { to: '/shared-with-me', label: 'Shared with me' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/performance', label: 'Performance' },
  { to: '/settings', label: 'Settings' },
];

// tb-listings-create-001: factors BrokerageApp's session/operator gating and
// header (previously the entire "/" route body) into a layout with <Outlet/>
// so /properties and its sibling routes can share it, mirroring AdminLayout's
// shape. The header/banner/panel now render on every brokerage route, not
// just "/", since they're workspace-wide state, not page content.
export function BrokerageLayout({ session, loading, operatorStatus }: Props) {
  const { status: workspaceStatus, refetch: refetchWorkspaceStatus } = useWorkspaceStatus(session);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const isActiveLink = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`);

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
          <Link to="/properties" className="text-sm font-semibold tracking-tight">
            Residoro
          </Link>
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
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:flex-row sm:gap-6 sm:px-6">
        {/* Side panel nav, mirroring AdminLayout's sidebar shape. Hidden below
            sm: -- a fixed sidebar column ate half the viewport at phone width
            (tested at 390px) -- where a floating trigger + bottom Sheet
            (below) takes over instead (tb-brokerage-mobile-bottom-nav-001). */}
        <nav className="hidden gap-1 sm:flex sm:w-48 sm:shrink-0 sm:flex-col">
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
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
      {/* Mobile nav: a small floating trigger fixed near the bottom of the
          viewport (below sm: only) opens a floating Sheet with the same nav
          links, replacing the earlier horizontally-scrolling pill row.
          Overrides SheetContent's default edge-to-edge `bottom` styling
          (inset-x-0 bottom-0, flush border-t) with margin + rounded corners
          so it actually reads as floating rather than a docked drawer. */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="Open navigation menu"
            className="fixed bottom-4 left-1/2 z-40 h-12 w-12 -translate-x-1/2 rounded-full border shadow-lg sm:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="inset-x-4 bottom-4 rounded-xl border shadow-2xl sm:hidden"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <nav className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileNavOpen(false)}
                aria-current={isActiveLink(link.to) ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-3 text-base font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
                  isActiveLink(link.to) && 'bg-accent text-foreground',
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}
