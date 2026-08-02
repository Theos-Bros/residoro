import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchProperties, type Property } from '@/lib/listingsApi';
import { linkPropertyToProject, type ProjectUnitsSummary } from '@/lib/projectsApi';
import { FloatingPanel } from '@/components/FloatingPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = {
  session: Session;
  projectId: string;
  projectName: string;
  unitsSummary: ProjectUnitsSummary | null;
  onClose: () => void;
  onLinked: () => void;
};

// tb-properties-project-link-001: "Add existing unit" -- lets an operator
// attach an already-created property (standalone creation, or Migration
// import) to a Project after the fact, as a fourth action alongside
// ProjectDetailPage's existing rollup/unit-types sections.
//
// Candidate exclusion is best-effort, not exact: GET /properties (this
// page's only source of the tenant's properties) doesn't return project_id
// -- that route is explicitly out of this tracer bullet's file/table
// boundary (a sibling kagebunshin clone owns PropertiesListPage.tsx/that
// query shape in this same batch), so there's no direct "already in this
// project" flag to filter on client-side. Instead this cross-references
// each candidate's title against the labels already fetched into this
// project's units summary (units_by_status: unit_number, falling back to
// title, per projects.ts's units-summary route) -- exact for properties
// linked without a custom unit_number (the common case for something
// linked via this very picker), but a bulk-generated unit whose unit_number
// differs from its title won't get excluded. Re-selecting an
// already-linked property is harmless either way -- the PATCH just sets
// project_id to the value it already has.
export function AddExistingUnitPanel({ session, projectId, projectName, unitsSummary, onClose, onLinked }: Props) {
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [query, setQuery] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchProperties(session.access_token)
      .then(({ properties }) => {
        if (!cancelled) setProperties(properties);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [session.access_token]);

  const labelsAlreadyInProject = useMemo(() => {
    const labels = new Set<string>();
    for (const bucket of unitsSummary?.by_unit_type ?? []) {
      for (const unitLabels of Object.values(bucket.units_by_status)) {
        for (const label of unitLabels) labels.add(label);
      }
    }
    return labels;
  }, [unitsSummary]);

  const candidates = useMemo(() => {
    if (!properties) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return properties
      .filter((property) => !labelsAlreadyInProject.has(property.title))
      .filter((property) => !normalizedQuery || property.title.toLowerCase().includes(normalizedQuery));
  }, [properties, labelsAlreadyInProject, query]);

  async function handleLink(propertyId: string) {
    setError(null);
    setLinkingId(propertyId);
    try {
      await linkPropertyToProject(session.access_token, propertyId, projectId);
      onLinked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLinkingId(null);
    }
  }

  return (
    <FloatingPanel title="Add existing unit" documentTitle={`${projectName} · Residoro`} onClose={onClose}>
      <div className="space-y-3">
        <Input
          placeholder="Search properties by title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {properties === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

        {properties && candidates.length === 0 && (
          <p className="text-sm text-muted-foreground">No matching properties to add.</p>
        )}

        {candidates.length > 0 && (
          <ul className="space-y-2">
            {candidates.map((property) => (
              <li key={property.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{property.title}</p>
                  <p className="text-xs text-muted-foreground">{property.status.replace(/_/g, ' ')}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={linkingId !== null}
                  onClick={() => handleLink(property.id)}
                >
                  {linkingId === property.id ? 'Adding…' : 'Add'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FloatingPanel>
  );
}
