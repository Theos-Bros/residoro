import type { Session } from '@supabase/supabase-js';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabaseClient';
import { useState } from 'react';
import { Building2, ClipboardList, Menu, Users } from 'lucide-react';
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
      { to: '/calendar', label: 'Calendar' },
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

// tb-design-system-states-mobile-001: the bottom nav's 3 direct-tap icons,
// per design doc section 07's mock (Inventory/Leads/Tasks/More -- Inventory
// is the whole "Inventory" NAV_GROUPS section since that's the group this
// role spends the most time in on-site; Leads and Tasks are individual
// Pipeline links, not the whole group, matching the doc exactly). "More"
// (below, in JSX) opens the full 11-link sheet rather than getting its own
// static entry here, so every route stays reachable -- reusing NAV_GROUPS'
// existing data, not a second hand-maintained list.
const BOTTOM_NAV_ITEMS: { groupLabel: string; to: string; label: string; icon: typeof Building2 }[] = [
  { groupLabel: 'Inventory', to: '/properties', label: 'Inventory', icon: Building2 },
  { groupLabel: 'Pipeline', to: '/leads', label: 'Leads', icon: Users },
  { groupLabel: 'Pipeline', to: '/tasks', label: 'Tasks', icon: ClipboardList },
];

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
  // Inventory's bottom-nav icon lights up for its whole NAV_GROUPS section
  // (Properties/Projects/Listings), not just an exact "/properties" match --
  // Leads/Tasks are single links, so they use isActiveLink directly instead.
  const inventoryGroup = NAV_GROUPS.find((group) => group.label === 'Inventory')!;
  const isBottomNavItemActive = (item: (typeof BOTTOM_NAV_ITEMS)[number]) =>
    item.groupLabel === 'Inventory'
      ? inventoryGroup.links.some((link) => isActiveLink(link.to))
      : isActiveLink(item.to);

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
        <main className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 sm:pb-6">
          <Outlet />
        </main>
      </div>
      {/* Mobile nav (Residoro Design Language, 2026-08-03): replaces
          tb-brokerage-mobile-bottom-nav-001's floating-trigger + bottom-Sheet
          mechanism with the persistent 4-icon bar the design doc's section 07
          mock actually shows (Inventory/Leads/Tasks/More, three always-visible
          icons + one overflow). Replaced rather than restyled because the two
          patterns genuinely conflict, not just cosmetically: the design doc's
          bar is *always on screen* with the active section visible in gold at
          a glance, where the old mechanism hid all nav behind one extra tap
          and had no persistent "where am I" indicator. The Sheet component
          itself isn't discarded, though -- it's reused as "More"'s overflow
          surface below, so all 11 routes (not just the 3 quick-tap ones)
          stay one tap away and NAV_GROUPS stays the single source of truth
          for nav data. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-card px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:hidden"
      >
        {BOTTOM_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isBottomNavItemActive(item);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] font-medium text-tertiary-foreground',
                active && 'text-accent-foreground',
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="More navigation options"
              className="flex flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] font-medium text-tertiary-foreground"
            >
              <Menu className="h-5 w-5" />
              More
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="inset-x-4 bottom-24 rounded-xl border shadow-2xl sm:hidden"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <nav className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
              {NAV_GROUPS.map((group) => (
                <div key={group.label} className="flex flex-col gap-0.5">
                  <span className="px-3 pb-1 font-mono text-[10px] font-medium uppercase tracking-widest text-tertiary-foreground">
                    {group.label}
                  </span>
                  {group.links.map((link) => (
                    <Link
                      key={link.to}
                      to={link.to}
                      onClick={() => setMobileNavOpen(false)}
                      aria-current={isActiveLink(link.to) ? 'page' : undefined}
                      className={cn(
                        'rounded-md px-3 py-2.5 text-base font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
                        isActiveLink(link.to) && 'bg-accent text-accent-foreground',
                      )}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </nav>
    </div>
  );
}
