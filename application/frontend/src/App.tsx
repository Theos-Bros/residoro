import { Navigate, Route, Routes } from 'react-router-dom';
import { useSupabaseSession } from './hooks/useSupabaseSession';
import { useOperatorStatus } from './hooks/useOperatorStatus';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { PropertiesListPage } from './pages/PropertiesListPage';
import { PropertyDetailPage } from './pages/PropertyDetailPage';
import { NewPropertyListingForm } from './pages/NewPropertyListingForm';
import { ProjectsListPage } from './pages/ProjectsListPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { NewProjectForm } from './pages/NewProjectForm';
import { ListingsPage } from './pages/ListingsPage';
import { LeadsPage } from './pages/LeadsPage';
import { RevisitPage } from './pages/RevisitPage';
import { SearchPage } from './pages/SearchPage';
import { ShareDocketForm } from './pages/ShareDocketForm';
import { SharedWithMePage } from './pages/SharedWithMePage';
import { TasksPage } from './pages/TasksPage';
import { CalendarPage } from './pages/CalendarPage';
import { ContactsPage } from './pages/ContactsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PerformancePage } from './pages/PerformancePage';
import { AdminApp } from './admin/AdminApp';
import { BrokerageLayout } from './BrokerageLayout';

// The pre-existing brokerage flow -- an operator session redirects to
// /admin instead of rendering here. Migration used to render inline below
// (MigrationPage) despite that redirect comment claiming operators drove it
// -- they couldn't reach this route at all, and the backend had no way to
// scope a migration to any tenant but the caller's own. Migration now lives
// only in the admin dashboard, tenant-selected by the operator; see
// tb-client-lifecycle-migration-execution-001.
//
// tb-listings-create-001: BrokerageLayout now carries the session/operator
// gating and shared header/banner (previously all of this route's body) so
// /properties can nest under it, the same way AdminLayout's <Outlet/> shares
// gating across the admin dashboard's routes. session/operatorStatus are
// computed once here and passed down, rather than each route independently
// re-subscribing -- see useSupabaseSession's comment for why. The index
// route redirects to /properties since there's no dashboard content of its
// own yet.
//
// tb-listings-lifecycle-001 (UX follow-up): the old /properties/:id/
// listings/new and /properties/:id/listings routes are gone -- "Create
// listing" and "Listing history" now open as floating panels from within
// PropertiesListPage/ListingsPage instead of navigating away (see
// CreateListingPanel / ListingHistoryPanel).
export function App() {
  const { session, loading } = useSupabaseSession();
  const operatorStatus = useOperatorStatus(session);

  return (
    <Routes>
      <Route element={<BrokerageLayout session={session} loading={loading} operatorStatus={operatorStatus} />}>
        <Route path="/" element={<Navigate to="/properties" replace />} />
        <Route path="/properties" element={session && <PropertiesListPage session={session} />} />
        <Route path="/properties/new" element={session && <NewPropertyListingForm session={session} />} />
        <Route path="/properties/:id" element={session && <PropertyDetailPage session={session} />} />
        <Route path="/projects" element={session && <ProjectsListPage session={session} />} />
        <Route path="/projects/new" element={session && <NewProjectForm session={session} />} />
        <Route path="/projects/:id" element={session && <ProjectDetailPage session={session} />} />
        <Route path="/listings" element={session && <ListingsPage session={session} />} />
        <Route path="/listings/:listingId/share" element={session && <ShareDocketForm session={session} />} />
        <Route path="/leads" element={session && <LeadsPage session={session} />} />
        <Route path="/revisit" element={session && <RevisitPage session={session} />} />
        <Route path="/search" element={session && <SearchPage session={session} />} />
        <Route path="/shared-with-me" element={session && <SharedWithMePage session={session} />} />
        <Route path="/tasks" element={session && <TasksPage session={session} />} />
        <Route path="/calendar" element={session && <CalendarPage session={session} />} />
        <Route path="/contacts" element={session && <ContactsPage session={session} />} />
        <Route path="/settings" element={session && <SettingsPage session={session} />} />
        <Route path="/performance" element={session && <PerformancePage session={session} />} />
      </Route>
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route
        path="/admin/*"
        element={<AdminApp session={session} loading={loading} operatorStatus={operatorStatus} />}
      />
    </Routes>
  );
}
