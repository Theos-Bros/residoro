import type { VerificationStatus } from './listingsApi';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type PropertyDetail = {
  id: string;
  title: string;
  type: string;
  address: string | null;
  city: string | null;
  province: string | null;
  floor_area_sqm: number | null;
  lot_area_sqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking_slots: number | null;
  price: number | null;
  price_currency: string;
  status: string;
  lease_monthly_rent: number | null;
  lease_term_months: number | null;
  verification_status: VerificationStatus;
  owner_type: string;
  owner_id: string | null;
  project_id: string | null;
  project_name: string | null;
};

export type MediaType = 'photo' | 'video';

export type PropertyMedia = {
  id: string;
  property_id: string;
  type: MediaType;
  external_url: string;
  sort_order: number;
  is_cover: boolean;
  created_at: string;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchProperty(accessToken: string, propertyId: string): Promise<PropertyDetail> {
  const response = await fetch(`${BACKEND_URL}/properties/${propertyId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchPropertyMedia(
  accessToken: string,
  propertyId: string,
): Promise<{ media: PropertyMedia[] }> {
  const response = await fetch(`${BACKEND_URL}/properties/${propertyId}/media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function addPropertyMediaLink(
  accessToken: string,
  propertyId: string,
  url: string,
  type: MediaType = 'photo',
): Promise<PropertyMedia> {
  const response = await fetch(`${BACKEND_URL}/properties/${propertyId}/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, type }),
  });
  return parseJsonOrThrow(response);
}

export async function updatePropertyMedia(
  accessToken: string,
  propertyId: string,
  mediaId: string,
  input: { sort_order?: number; is_cover?: boolean },
): Promise<PropertyMedia> {
  const response = await fetch(`${BACKEND_URL}/properties/${propertyId}/media/${mediaId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function deletePropertyMedia(
  accessToken: string,
  propertyId: string,
  mediaId: string,
): Promise<{ success: boolean }> {
  const response = await fetch(`${BACKEND_URL}/properties/${propertyId}/media/${mediaId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}
