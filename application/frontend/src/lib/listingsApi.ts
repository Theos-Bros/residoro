const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type Property = {
  id: string;
  title: string;
  price: number | null;
  price_currency: string;
  status: string;
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

export type OwnerType = 'developer' | 'individual' | 'company';

export type Listing = {
  id: string;
  property_id: string;
  property_title: string;
  agent_id: string;
  listing_type: 'sale' | 'rent';
  price: number;
  price_currency: string;
  exclusivity: 'exclusive' | 'open';
  authority_starts_at: string;
  authority_expires_at: string | null;
  status: 'draft' | 'active' | 'withdrawn';
  created_at: string;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchProperties(accessToken: string): Promise<{ properties: Property[] }> {
  const response = await fetch(`${BACKEND_URL}/properties`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchListings(accessToken: string): Promise<{ listings: Listing[] }> {
  const response = await fetch(`${BACKEND_URL}/listings`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function createProperty(
  accessToken: string,
  input: {
    title: string;
    type: PropertyType;
    owner_type: OwnerType;
    address?: string;
    city?: string;
    province?: string;
    floor_area_sqm?: number;
    lot_area_sqm?: number;
    bedrooms?: number;
    bathrooms?: number;
    parking_slots?: number;
    price?: number;
    price_currency?: string;
  },
): Promise<Property> {
  const response = await fetch(`${BACKEND_URL}/properties`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function createListing(
  accessToken: string,
  input: {
    property_id: string;
    listing_type: 'sale' | 'rent';
    price: number;
    exclusivity?: 'exclusive' | 'open';
    authority_starts_at?: string;
    authority_expires_at?: string | null;
  },
): Promise<Listing> {
  const response = await fetch(`${BACKEND_URL}/listings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function updateListingStatus(
  accessToken: string,
  listingId: string,
  status: 'active' | 'withdrawn',
): Promise<{ id: string; status: string; warning?: string }> {
  const response = await fetch(`${BACKEND_URL}/listings/${listingId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });
  return parseJsonOrThrow(response);
}
