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

// Residoro Design Language (2026-08-03): the same 11 routes, regrouped into
// the sidebar's four labeled sections (Inventory/Pipeline/CRM & Sharing/
// Brokerage) instead of one flat list -- matches the design doc's shell
// exactly in structure, though the doc's per-item record counts ("128",
// "341", "12 unread") aren't wired up here since no hook fetches those
// counts today; adding one would be new functionality, not a re-skin.
const NAV_GROUPS: { label: string; links: { to: string; label: string }[] }[] = [
  {
    label: 'Inventory',
    links: [
      { to: '/properties', label: 'Properties' },
      { to: '/projects', label: 'Projects' },
      { to: '/listings', label: 'Listings' },
    ],
  },
  {
    label: 'Pipeline',
    links: [
      { to: '/leads', label: 'Leads' },
      { to: '/revisit', label: 'Revisit' },
      { to: '/tasks', label: 'Tasks' },
    ],
  },
  {
    label: 'CRM & Sharing',
    links: [
      { to: '/contacts', label: 'Contacts' },
      { to: '/search', label: 'Search' },
      { to: '/shared-with-me', label: 'Shared with me' },
    ],
  },
  {
    label: 'Brokerage',
    links: [
      { to: '/performance', label: 'Performance' },
      { to: '/settings', label: 'Settings' },
    ],
  },
];
const NAV_LINKS = NAV_GROUPS.flatMap((group) => group.links);

function initialsOf(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/).filter(Boolean);
  const initials = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : local.slice(0, 2);
  return initials.toUpperCase();
}

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
    <div className="flex min-h-screen bg-background">
      {/* Sidebar, per the Residoro Design Language (2026-08-03) shell: logo
          header, four grouped nav sections, user footer. Hidden below sm: --
          a fixed sidebar column ate half the viewport at phone width (tested
          at 390px) -- where a floating trigger + bottom Sheet (below) takes
          over instead (tb-brokerage-mobile-bottom-nav-001). */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card sm:flex">
        <div className="flex items-center gap-2.5 border-b px-4 py-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent-foreground/40 to-primary text-sm font-bold text-primary-foreground [background:linear-gradient(150deg,hsl(var(--accent)),hsl(var(--primary)))]">
            R
          </div>
          <Link to="/properties" className="text-sm font-semibold tracking-tight text-foreground">
            Residoro
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <span className="px-2 pb-1.5 font-mono text-[10px] font-medium uppercase tracking-widest text-tertiary-foreground">
                {group.label}
              </span>
              {group.links.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  aria-current={isActiveLink(link.to) ? 'page' : undefined}
                  className={cn(
                    'rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground',
                    isActiveLink(link.to) && 'bg-accent font-semibold text-accent-foreground shadow-[inset_2px_0_0_hsl(var(--primary))] hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2.5 border-t px-3 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
            {initialsOf(session.user.email ?? '')}
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-medium text-foreground">{session.user.email}</span>
            {workspaceStatus && (
              // tb-design-system-role-badge-001: workspaceStatus.role is already fetched via
              // useWorkspaceStatus above -- no new request. profiles.role's real value set
              // reaching this route is 'admin' | 'member' (see platform_foundation.sql's
              // profiles_role_check); 'operator' exists as a third DB value but requireAuth
              // (which /me/workspace-status runs behind) rejects operators outright since they
              // have no tenant_id, so this component never sees 'operator' in practice.
              <span className="text-xs text-tertiary-foreground">
                {workspaceStatus.role === 'admin' ? 'Admin' : 'Member'}
              </span>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-2 border-b bg-card px-4 sm:px-6">
          <span className="hidden text-sm text-tertiary-foreground sm:inline">{session.user.email}</span>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export My Data'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
            Sign out
          </Button>
        </header>
        {exportError && (
          <p role="alert" className="bg-card px-4 pb-2 text-sm text-destructive sm:px-6">
            {exportError}
          </p>
        )}
        <ContractWarningBanner status={workspaceStatus} />
        <ContractNotificationPanel
          session={session}
          notifications={workspaceStatus?.notifications ?? []}
          onDismissed={refetchWorkspaceStatus}
        />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">
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
