import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  createDeveloper,
  createProject,
  fetchDevelopers,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  type Developer,
  type ProjectStatus,
  type ProjectType,
} from '@/lib/projectsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toSentenceCase } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  session: Session;
};

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';
const NEW_DEVELOPER_VALUE = '__new__';

// tb-properties-project-001: developers starts empty for every tenant (a
// brand-new table, see this tracer bullet's Context), so this form always
// offers "add a new developer" inline rather than assuming one already
// exists to pick from -- the operator/admin creates both in one submit the
// first time, same one-flow pattern as NewPropertyListingForm's
// property+listing combo.
export function NewProjectForm({ session }: Props) {
  const [developers, setDevelopers] = useState<Developer[] | null>(null);
  const [developerId, setDeveloperId] = useState<string>(NEW_DEVELOPER_VALUE);
  const [newDeveloperName, setNewDeveloperName] = useState('');

  const [name, setName] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('condo');
  const [location, setLocation] = useState('');
  const [totalUnits, setTotalUnits] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('pre_selling');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    fetchDevelopers(session.access_token)
      .then(({ developers }) => {
        if (cancelled) return;
        setDevelopers(developers);
        if (developers.length > 0) setDeveloperId(developers[0].id);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [session.access_token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Project name is required.');
      return;
    }
    if (developerId === NEW_DEVELOPER_VALUE && !newDeveloperName.trim()) {
      setError('Developer name is required.');
      return;
    }

    const numericTotalUnits = totalUnits ? Number(totalUnits) : undefined;
    if (totalUnits && (!Number.isInteger(numericTotalUnits) || (numericTotalUnits as number) < 0)) {
      setError('Total units must be a non-negative whole number.');
      return;
    }

    setSubmitting(true);
    try {
      const resolvedDeveloperId =
        developerId === NEW_DEVELOPER_VALUE
          ? (await createDeveloper(session.access_token, { name: newDeveloperName.trim() })).id
          : developerId;

      const project = await createProject(session.access_token, {
        developer_id: resolvedDeveloperId,
        name: name.trim(),
        project_type: projectType,
        location: location || undefined,
        total_units: numericTotalUnits,
        status,
      });

      navigate(`/projects/${project.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="developer">
                Developer <span className="text-primary">*</span>
              </Label>
              <select
                id="developer"
                value={developerId}
                onChange={(e) => setDeveloperId(e.target.value)}
                className={selectClass}
              >
                {developers?.map((developer) => (
                  <option key={developer.id} value={developer.id}>
                    {developer.name}
                  </option>
                ))}
                <option value={NEW_DEVELOPER_VALUE}>+ Add a new developer</option>
              </select>
            </div>
            {developerId === NEW_DEVELOPER_VALUE && (
              <div className="space-y-1.5">
                <Label htmlFor="new_developer_name">
                  New developer name <span className="text-primary">*</span>
                </Label>
                <Input
                  id="new_developer_name"
                  type="text"
                  value={newDeveloperName}
                  onChange={(e) => setNewDeveloperName(e.target.value)}
                  required
                />
              </div>
            )}

            <Separator className="my-2" />

            <div className="space-y-1.5">
              <Label htmlFor="name">
                Project name <span className="text-primary">*</span>
              </Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Tower A, Makati"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project_type">
                Project type <span className="text-primary">*</span>
              </Label>
              <select
                id="project_type"
                value={projectType}
                onChange={(e) => setProjectType(e.target.value as ProjectType)}
                className={selectClass}
              >
                {PROJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {toSentenceCase(t)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">Location (optional)</Label>
              <Input id="location" type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="total_units">Total units (optional)</Label>
              <Input
                id="total_units"
                type="number"
                min="0"
                step="1"
                value={totalUnits}
                onChange={(e) => setTotalUnits(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">
                Status <span className="text-primary">*</span>
              </Label>
              <select
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                className={selectClass}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {toSentenceCase(s)}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Creating…' : 'Create project'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
