const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type ProjectType = 'condo' | 'subdivision' | 'township' | 'mixed_use';
export type ProjectStatus = 'pre_selling' | 'under_construction' | 'ready_for_occupancy' | 'sold_out';

export const PROJECT_TYPES: readonly ProjectType[] = ['condo', 'subdivision', 'township', 'mixed_use'];
export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  'pre_selling',
  'under_construction',
  'ready_for_occupancy',
  'sold_out',
];

export type Developer = {
  id: string;
  name: string;
  contact_info: Record<string, unknown> | null;
};

export type Project = {
  id: string;
  developer_id: string;
  developer_name: string;
  name: string;
  project_type: ProjectType;
  location: string | null;
  total_units: number | null;
  status: ProjectStatus;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchDevelopers(accessToken: string): Promise<{ developers: Developer[] }> {
  const response = await fetch(`${BACKEND_URL}/developers`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function createDeveloper(accessToken: string, input: { name: string }): Promise<Developer> {
  const response = await fetch(`${BACKEND_URL}/developers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function fetchProjects(accessToken: string): Promise<{ projects: Project[] }> {
  const response = await fetch(`${BACKEND_URL}/projects`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchProject(accessToken: string, projectId: string): Promise<Project> {
  const response = await fetch(`${BACKEND_URL}/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function createProject(
  accessToken: string,
  input: {
    developer_id: string;
    name: string;
    project_type: ProjectType;
    location?: string;
    total_units?: number;
    status?: ProjectStatus;
  },
): Promise<Project> {
  const response = await fetch(`${BACKEND_URL}/projects`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}
