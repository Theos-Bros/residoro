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

export type PropertyType =
  | 'condo_unit'
  | 'house_and_lot'
  | 'lot_only'
  | 'townhouse'
  | 'commercial'
  | 'warehouse'
  | 'agricultural'
  | 'industrial';

export const PROPERTY_TYPES: readonly PropertyType[] = [
  'condo_unit',
  'house_and_lot',
  'lot_only',
  'townhouse',
  'commercial',
  'warehouse',
  'agricultural',
  'industrial',
];

export type ProjectUnitType = {
  id: string;
  project_id: string;
  name: string;
  property_type: PropertyType;
  floor_area_sqm: number | null;
  lot_area_sqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking_slots: number | null;
  price: number | null;
  price_currency: string;
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

export async function fetchUnitTypes(
  accessToken: string,
  projectId: string,
): Promise<{ unit_types: ProjectUnitType[] }> {
  const response = await fetch(`${BACKEND_URL}/projects/${projectId}/unit-types`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function createUnitType(
  accessToken: string,
  projectId: string,
  input: {
    name: string;
    property_type: PropertyType;
    floor_area_sqm?: number;
    lot_area_sqm?: number;
    bedrooms?: number;
    bathrooms?: number;
    parking_slots?: number;
    price?: number;
    price_currency?: string;
  },
): Promise<ProjectUnitType> {
  const response = await fetch(`${BACKEND_URL}/projects/${projectId}/unit-types`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function generateUnits(
  accessToken: string,
  projectId: string,
  unitTypeId: string,
  count: number,
): Promise<{ created: number; property_ids: string[] }> {
  const response = await fetch(`${BACKEND_URL}/projects/${projectId}/unit-types/${unitTypeId}/generate-units`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  });
  return parseJsonOrThrow(response);
}
