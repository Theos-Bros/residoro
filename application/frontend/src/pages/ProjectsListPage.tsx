import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchProjects, type Project } from '@/lib/projectsApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Props = {
  session: Session;
};

// tb-properties-project-001: mirrors PropertiesListPage's shape -- a minimal
// list + a link into a separate create form, since picking/browsing projects
// is all this tracer bullet needs this view to do. Bulk unit generation and
// project-level rollup views ("145/200 available") are deliberately not
// here -- see the tracer bullet's semantic_scope.
export function ProjectsListPage({ session }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchProjects(session.access_token)
      .then(({ projects }) => {
        if (!cancelled) setProjects(projects);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [session.access_token]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <Button asChild size="sm">
          <Link to="/projects/new">New project</Link>
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && projects === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {projects?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No projects yet. Developer inventory (e.g. a condo tower or subdivision) lives here, distinct from
          standalone resale properties.
        </p>
      )}

      {projects && projects.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Developer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Total units</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="font-medium">
                    <Link to={`/projects/${project.id}`} className="hover:underline">
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell>{project.developer_name}</TableCell>
                  <TableCell>{project.project_type.replace(/_/g, ' ')}</TableCell>
                  <TableCell>{project.location ?? '—'}</TableCell>
                  <TableCell>{project.total_units ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{project.status.replace(/_/g, ' ')}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
