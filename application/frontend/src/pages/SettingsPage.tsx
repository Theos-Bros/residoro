import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import { SharingTemplatesPanel } from '@/components/SharingTemplatesPanel';
import { PerformanceSettingsPanel } from '@/components/PerformanceSettingsPanel';
import { MatchingSettingsPanel } from '@/components/MatchingSettingsPanel';
import { TaskRoutingSettingsPanel } from '@/components/TaskRoutingSettingsPanel';
import { PermissionsSettingsPanel } from '@/components/PermissionsSettingsPanel';
import { cn } from '@/lib/utils';

type Props = {
  session: Session;
};

// tb-distribution-share-text-001: first Settings sub-section. The
// sub-nav/panel split exists so future sub-sections (e.g. task/lead routing
// to team members, per user's own stated direction 2026-07-27) are just
// another entry + panel, not a rework of this page's shape.
//
// tb-analytics-share-performance-001: second sub-section, arriving exactly as
// planned -- no rework of SettingsPage's shape needed, just one more entry.
//
// tb-brokerage-permissions-delegation-001: third sub-section, but the one
// exception to "every sub-section is visible to everyone" -- Permissions is
// admin-only to view at all, pushed onto SECTIONS conditionally below rather
// than living in the static array, since who-can-edit-what is an
// admin-management concern, not something a regular member needs to see.
//
// tb-tasks-crud-001: fourth sub-section -- the exact extension point this
// file's own code comment (above, dated 2026-07-27, before cap-tasks-001
// existed) anticipated ("task/lead routing to team members").
const BASE_SECTIONS = [
  { id: 'sharing-templates', label: 'Sharing Templates' },
  { id: 'performance', label: 'Performance' },
  { id: 'matching', label: 'Matching' },
  { id: 'tasks', label: 'Tasks' },
] as const;
const PERMISSIONS_SECTION = { id: 'permissions', label: 'Permissions' } as const;
type SectionId = (typeof BASE_SECTIONS)[number]['id'] | typeof PERMISSIONS_SECTION.id;

export function SettingsPage({ session }: Props) {
  const [activeSection, setActiveSection] = useState<SectionId>('sharing-templates');
  const { status } = useWorkspaceStatus(session);
  const isAdmin = status?.role === 'admin';
  const sections = isAdmin ? [...BASE_SECTIONS, PERMISSIONS_SECTION] : BASE_SECTIONS;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        <nav className="flex gap-1 sm:w-48 sm:shrink-0 sm:flex-col">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={cn(
                'rounded-md px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
                activeSection === section.id && 'bg-accent text-foreground',
              )}
            >
              {section.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {activeSection === 'sharing-templates' && <SharingTemplatesPanel session={session} />}
          {activeSection === 'performance' && <PerformanceSettingsPanel session={session} />}
          {activeSection === 'matching' && <MatchingSettingsPanel session={session} />}
          {activeSection === 'tasks' && <TaskRoutingSettingsPanel session={session} />}
          {activeSection === 'permissions' && isAdmin && <PermissionsSettingsPanel session={session} />}
        </div>
      </div>
    </div>
  );
}
