import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchProject, fetchUnitTypes, type Project, type ProjectUnitType } from '@/lib/projectsApi';
import { UnitTypesSection } from '@/components/UnitTypesSection';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

// tb-properties-project-001: deliberately minimal -- core fields read-only,
// no rollup view of the project's own units (see semantic_scope; that's a
// follow-on tracer bullet once bulk unit generation exists to populate one).
export function ProjectDetailPage({ session }: Props) {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [unitTypes, setUnitTypes] = useState<ProjectUnitType[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    Promise.all([fetchProject(session.access_token, id), fetchUnitTypes(session.access_token, id)])
      .then(([projectResult, unitTypesResult]) => {
        if (cancelled) return;
        setProject(projectResult);
        setUnitTypes(unitTypesResult.unit_types);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [id, session.access_token]);

  if (!id) return null;

  return (
    <div className="space-y-6">
      <Button asChild variant="secondary" size="sm">
        <Link to="/projects">← Back to projects</Link>
      </Button>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && project === null && <p className="text-sm text-muted-foreground">Loading…</p>}

      {project && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <Badge variant="outline">{project.status.replace(/_/g, ' ')}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Developer: {project.developer_name}</p>
          <p className="text-sm text-muted-foreground">Type: {project.project_type.replace(/_/g, ' ')}</p>
          <p className="text-sm text-muted-foreground">Location: {project.location ?? '—'}</p>
          <p className="text-sm text-muted-foreground">Total units: {project.total_units ?? '—'}</p>

          <div className="space-y-2 pt-4">
            <h2 className="text-lg font-semibold tracking-tight">Unit types</h2>
            {unitTypes === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <UnitTypesSection
                session={session}
                projectId={id}
                unitTypes={unitTypes}
                onChange={setUnitTypes}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
