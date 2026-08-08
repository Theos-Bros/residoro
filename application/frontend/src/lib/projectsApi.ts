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
  storeys: number | null;
  features: string[] | null;
  price: number | null;
  price_currency: string;
  listing_type: 'sale' | 'lease';
  exclusivity: 'exclusive' | 'open';
};

// tb-properties-unit-leasing-001: a third, independent copy of this same
// enum (see application/backend/src/routes/{projects,listings}.ts) -- kept
// in sync by hand, no shared-types package in this codebase.
export type PropertyStatus = 'available' | 'reserved' | 'sold' | 'off_market' | 'leased';
export const PROPERTY_STATUSES: readonly PropertyStatus[] = [
  'available',
  'reserved',
  'sold',
  'off_market',
  'leased',
];

export type StatusCounts = Record<PropertyStatus, number>;

export type UnitLabelsByStatus = Record<PropertyStatus, string[]>;

export type ProjectUnitTypeSummary = {
  unit_type_id: string | null;
  unit_type_name: string;
  total: number;
  by_status: StatusCounts;
  units_by_status: UnitLabelsByStatus;
};

export type ProjectUnitsSummary = {
  total: number;
  by_status: StatusCounts;
  declared_total_units: number | null;
  by_unit_type: ProjectUnitTypeSummary[];
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
    storeys?: number;
    features?: string[];
    price?: number;
    price_currency?: string;
    listing_type?: 'sale' | 'lease';
    exclusivity?: 'exclusive' | 'open';
  },
): Promise<ProjectUnitType> {
  const response = await fetch(`${BACKEND_URL}/projects/${projectId}/unit-types`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function removeUnits(
  accessToken: string,
  projectId: string,
  unitTypeId: string,
  unitNumbers: string[],
): Promise<{ deleted: number; unit_numbers: string[] }> {
  const response = await fetch(`${BACKEND_URL}/projects/${projectId}/unit-types/${unitTypeId}/units`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit_numbers: unitNumbers }),
  });
  return parseJsonOrThrow(response);
}

export async function fetchProjectUnitsSummary(
  accessToken: string,
  projectId: string,
): Promise<ProjectUnitsSummary> {
  const response = await fetch(`${BACKEND_URL}/projects/${projectId}/units-summary`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

// tb-properties-project-link-001: lets an already-existing property (created
// standalone, or via Migration import) join a project after the fact --
// "Add existing unit" on ProjectDetailPage.tsx. Backed by the extended
// PATCH /properties/:id (listings.ts), not a projects.ts route -- project_id
// lives on `properties`, so the write goes through the same endpoint
// updateProperty (listingsApi.ts) already uses, just with a narrower body.
// The backend re-verifies the property is (already) owner_type ===
// 'developer' and that the project belongs to the caller's own tenant --
// this helper does no validation of its own.
export async function linkPropertyToProject(
  accessToken: string,
  propertyId: string,
  projectId: string,
): Promise<{ id: string; project_id: string | null }> {
  const response = await fetch(`${BACKEND_URL}/properties/${propertyId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId }),
  });
  return parseJsonOrThrow(response);
}

export async function generateUnits(
  accessToken: string,
  projectId: string,
  unitTypeId: string,
  unitNumbers: string[],
): Promise<{ created: number; property_ids: string[]; listings_created: number }> {
  const response = await fetch(`${BACKEND_URL}/projects/${projectId}/unit-types/${unitTypeId}/generate-units`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit_numbers: unitNumbers }),
  });
  return parseJsonOrThrow(response);
}
