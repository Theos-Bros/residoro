const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'flagged';

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  'unverified',
  'pending',
  'verified',
  'flagged',
];

export type Property = {
  id: string;
  title: string;
  price: number | null;
  price_currency: string;
  status: string;
  verification_status: VerificationStatus;
  cover_photo_url?: string;
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

export type PropertyStatus = 'available' | 'reserved' | 'sold' | 'off_market';

export const PROPERTY_STATUSES: readonly PropertyStatus[] = ['available', 'reserved', 'sold', 'off_market'];

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
  status: ListingStatus;
  created_at: string;
  buyer_contact_id: string | null;
  buyer_name: string | null;
};

export type ListingStatus = 'draft' | 'active' | 'under_offer' | 'sold' | 'expired' | 'withdrawn';

// tb-listings-lifecycle-001: mirrors the backend's STATUS_TRANSITIONS in
// listings.ts -- kept in sync by hand since this is a small, stable state
// machine, not generated from a shared schema. sold/withdrawn are terminal
// (empty arrays).
//
// UX follow-up (same session): 'expired' no longer reachable from
// active/under_offer here -- the backend auto-expires a listing once its
// authority_expires_at passes (checked on every read/write, no cron), so
// there's no manual "Mark Expired" action to offer. 'expired' -> 'active' is
// still listed as legal, but the UI never renders it as a plain button --
// ListingsPage special-cases 'expired' rows into a renewal control instead
// (see handleRenew), since reactivating without a new authority_expires_at
// just gets auto-re-expired on the next read.
export const LISTING_STATUS_TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  draft: ['active', 'withdrawn'],
  active: ['under_offer', 'withdrawn'],
  under_offer: ['sold', 'active'],
  sold: [],
  expired: ['active', 'withdrawn'],
  withdrawn: [],
};

// UX follow-up: an expired listing's warning names which document lapsed --
// Authority to Sell (sale) or Authority to Lease (rent) -- so the agent
// knows what to go re-secure, not just that "something" expired.
export function authorityWarningLabel(listingType: 'sale' | 'rent'): string {
  return listingType === 'rent' ? 'Needs updated ATL' : 'Needs updated ATS';
}

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

// tb-properties-verification-001: admin-only, enforced server-side (403 for
// non-admins) -- the frontend only hides the control for non-admins, it
// doesn't rely on that hiding for the actual authorization.
export async function updatePropertyVerification(
  accessToken: string,
  propertyId: string,
  verificationStatus: VerificationStatus,
): Promise<{ id: string; verification_status: VerificationStatus }> {
  const response = await fetch(`${BACKEND_URL}/properties/${propertyId}/verification`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ verification_status: verificationStatus }),
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
    project_id?: string;
    owner_id?: string;
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

// tb-properties-edit-001: general fields open to any tenant user (matching
// createProperty's own lack of a role check); owner_type/owner_id are
// admin-only server-side (403 otherwise) -- callers should only include them
// when the current user is an admin, but the real enforcement is the
// backend's role check, not this client omitting them.
export async function updateProperty(
  accessToken: string,
  propertyId: string,
  patch: {
    title?: string;
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
    status?: PropertyStatus;
    owner_type?: OwnerType;
    owner_id?: string | null;
  },
): Promise<Property> {
  const response = await fetch(`${BACKEND_URL}/properties/${propertyId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
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
  status: ListingStatus,
  extra?: { authority_starts_at?: string; authority_expires_at?: string | null; buyer_contact_id?: string },
): Promise<{ id: string; status: string; buyer_contact_id?: string | null; warning?: string }> {
  const response = await fetch(`${BACKEND_URL}/listings/${listingId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status, ...extra }),
  });
  return parseJsonOrThrow(response);
}

// tb-listings-lifecycle-001: full history for one property -- every listing
// it's ever had, any status, chronological. Listings are never deleted, so
// this is the complete record, not just the current active one.
export async function fetchPropertyListingHistory(
  accessToken: string,
  propertyId: string,
): Promise<{ listings: Listing[] }> {
  const response = await fetch(`${BACKEND_URL}/properties/${propertyId}/listings`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export const DOCKET_LISTING_FIELDS = [
  'listing_type',
  'price',
  'price_currency',
  'exclusivity',
  'authority_starts_at',
  'authority_expires_at',
  'status',
] as const;

export const DOCKET_PROPERTY_FIELDS = [
  'title',
  'type',
  'address',
  'city',
  'province',
  'floor_area_sqm',
  'lot_area_sqm',
  'bedrooms',
  'bathrooms',
  'parking_slots',
] as const;

export type DocketField = (typeof DOCKET_LISTING_FIELDS)[number] | (typeof DOCKET_PROPERTY_FIELDS)[number];

export type CreatedDocket = {
  id: string;
  source_listing_id: string;
  shared_with: string;
  included_fields: DocketField[];
  status: 'active' | 'revoked';
  created_at: string;
};

export type ReceivedDocket = {
  id: string;
  shared_by_handle: string | null;
  fields: Record<string, unknown>;
  created_at: string;
};

export async function createDocket(
  accessToken: string,
  input: { listing_id: string; handle: string; included_fields: DocketField[] },
): Promise<CreatedDocket> {
  const response = await fetch(`${BACKEND_URL}/listing-dockets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function fetchReceivedDockets(accessToken: string): Promise<{ dockets: ReceivedDocket[] }> {
  const response = await fetch(`${BACKEND_URL}/listing-dockets/received`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function revokeDocket(accessToken: string, docketId: string): Promise<{ id: string; status: string }> {
  const response = await fetch(`${BACKEND_URL}/listing-dockets/${docketId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'revoked' }),
  });
  return parseJsonOrThrow(response);
}
