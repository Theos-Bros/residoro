import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import { SharingTemplatesPanel } from '@/components/SharingTemplatesPanel';
import { PerformanceSettingsPanel } from '@/components/PerformanceSettingsPanel';
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
const SECTIONS = [
  { id: 'sharing-templates', label: 'Sharing Templates' },
  { id: 'performance', label: 'Performance' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

export function SettingsPage({ session }: Props) {
  const [activeSection, setActiveSection] = useState<SectionId>('sharing-templates');
  const { status } = useWorkspaceStatus(session);
  const isAdmin = status?.role === 'admin';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        <nav className="flex gap-1 sm:w-48 sm:shrink-0 sm:flex-col">
          {SECTIONS.map((section) => (
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
          {activeSection === 'sharing-templates' && <SharingTemplatesPanel session={session} isAdmin={isAdmin} />}
          {activeSection === 'performance' && <PerformanceSettingsPanel session={session} isAdmin={isAdmin} />}
        </div>
      </div>
    </div>
  );
}
