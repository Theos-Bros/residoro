import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  fetchProject,
  fetchProjectUnitsSummary,
  fetchUnitTypes,
  type Project,
  type ProjectUnitsSummary,
  type ProjectUnitType,
} from '@/lib/projectsApi';
import { UnitTypesSection } from '@/components/UnitTypesSection';
import { UnitsSummarySection } from '@/components/UnitsSummarySection';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

export function ProjectDetailPage({ session }: Props) {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [unitTypes, setUnitTypes] = useState<ProjectUnitType[] | null>(null);
  const [unitsSummary, setUnitsSummary] = useState<ProjectUnitsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetchUnitsSummary = useCallback(() => {
    if (!id) return;
    fetchProjectUnitsSummary(session.access_token, id)
      .then(setUnitsSummary)
      .catch((err: Error) => setError(err.message));
  }, [id, session.access_token]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    Promise.all([
      fetchProject(session.access_token, id),
      fetchUnitTypes(session.access_token, id),
      fetchProjectUnitsSummary(session.access_token, id),
    ])
      .then(([projectResult, unitTypesResult, unitsSummaryResult]) => {
        if (cancelled) return;
        setProject(projectResult);
        setUnitTypes(unitTypesResult.unit_types);
        setUnitsSummary(unitsSummaryResult);
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
            <h2 className="text-lg font-semibold tracking-tight">Units summary</h2>
            {unitsSummary === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <UnitsSummarySection summary={unitsSummary} />
            )}
          </div>

          <div className="space-y-2 pt-4">
            <h2 className="text-lg font-semibold tracking-tight">Unit types</h2>
            {unitTypes === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <UnitTypesSection
                session={session}
                projectId={id}
                developerName={project.developer_name}
                projectName={project.name}
                unitTypes={unitTypes}
                onChange={setUnitTypes}
                onUnitsChanged={refetchUnitsSummary}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
