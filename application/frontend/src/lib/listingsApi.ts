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
  // tb-listings-properties-keyword-search-001: added so PropertiesListPage's
  // keyword filter can match against address alongside title.
  address: string | null;
  price: number | null;
  price_currency: string;
  status: string;
  verification_status: VerificationStatus;
  cover_photo_url?: string;
  // tb-listings-property-specs-001: previously fetched by nobody -- GET
  // /properties now selects these too, so rows can show a specs summary.
  floor_area_sqm: number | null;
  lot_area_sqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking_slots: number | null;
  storeys: number | null;
  features: string[] | null;
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

// tb-properties-unit-leasing-001: 'leased' is a fifth, unit-level terminal
// status distinct from listings.listing_type = 'lease' (an unrelated concept
// -- listing_type is active marketing/authority for a unit, not that the
// unit is already leased out). lease_monthly_amount/lease_term_months (see
// Property/updateProperty below) are only ever populated for this status.
export type PropertyStatus = 'available' | 'reserved' | 'sold' | 'off_market' | 'leased';

export const PROPERTY_STATUSES: readonly PropertyStatus[] = [
  'available',
  'reserved',
  'sold',
  'off_market',
  'leased',
];

// Residoro Design Language (2026-08-03): status -> Badge variant, so every
// status chip across the app reads consistently instead of each page picking
// its own Badge variant ad hoc. success=live/positive, warning=pending,
// neutral=quiet/settled, danger=alarming.
export const PROPERTY_STATUS_VARIANT: Record<
  PropertyStatus,
  'success' | 'warning' | 'neutral'
> = {
  available: 'success',
  reserved: 'warning',
  sold: 'neutral',
  off_market: 'neutral',
  leased: 'neutral',
};

export type Listing = {
  id: string;
  property_id: string;
  property_title: string;
  // tb-listings-properties-keyword-search-001: added so ListingsPage's
  // keyword filter can match against address alongside property_title.
  property_address: string | null;
  // City isn't concatenated into property_address server-side -- kept separate
  // since callers needing a full geocodable address (the NOAH hazard-check link)
  // are the exception, not the common case for property_address's other uses.
  property_city: string | null;
  // tb-listings-property-specs-001: embedded from the same properties(...)
  // sub-select as property_title/property_address above.
  property_floor_area_sqm: number | null;
  property_lot_area_sqm: number | null;
  property_bedrooms: number | null;
  property_bathrooms: number | null;
  property_parking_slots: number | null;
  property_storeys: number | null;
  property_features: string[] | null;
  agent_id: string;
  listing_type: 'sale' | 'lease';
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

export type ListingStatus =
  | 'draft'
  | 'active'
  | 'under_offer'
  | 'sold'
  | 'expired'
  | 'withdrawn'
  | 'inactive';

// tb-listings-detail-edit-modal-001: moved here from ListingsPage.tsx so
// ListingDetailModal can share the same labels for the relocated
// status-action controls.
export const STATUS_LABEL: Record<ListingStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  under_offer: 'Under Offer',
  sold: 'Sold',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
  inactive: 'Inactive',
};

// Residoro Design Language (2026-08-03): same status -> Badge variant
// mapping as PROPERTY_STATUS_VARIANT above, for listing status chips.
export const LISTING_STATUS_VARIANT: Record<
  ListingStatus,
  'success' | 'warning' | 'neutral' | 'danger'
> = {
  draft: 'neutral',
  active: 'success',
  under_offer: 'warning',
  sold: 'neutral',
  expired: 'danger',
  withdrawn: 'danger',
  inactive: 'neutral',
};

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
//
// tb-listings-status-ladder-001: 'inactive' is a new pausable state reachable
// from 'active' (active <-> inactive), additive alongside 'draft'. 'sold' was
// already terminal before this change.
export const LISTING_STATUS_TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  draft: ['active', 'withdrawn'],
  active: ['under_offer', 'inactive', 'withdrawn'],
  inactive: ['active', 'withdrawn'],
  under_offer: ['sold', 'active'],
  sold: [],
  expired: ['active', 'withdrawn'],
  withdrawn: [],
};

// UX follow-up: an expired listing's warning names which document lapsed --
// Authority to Sell (sale) or Authority to Lease (lease) -- so the agent
// knows what to go re-secure, not just that "something" expired.
export function authorityWarningLabel(listingType: 'sale' | 'lease'): string {
  return listingType === 'lease' ? 'Needs updated ATL' : 'Needs updated ATS';
}

// tb-listings-properties-keyword-search-001: shared by ListingsPage's
// filteredListings useMemo and PropertiesListPage's filteredProperties
// useMemo -- case-insensitive substring match against title and/or address
// only, per this tracer bullet's semantic_scope (no owner-name or other
// joined-field matching). An empty/whitespace-only keyword always matches
// (keyword filter is a no-op when cleared).
export function matchesKeyword(title: string, address: string | null, keyword: string): boolean {
  const trimmed = keyword.trim().toLowerCase();
  if (!trimmed) return true;
  return title.toLowerCase().includes(trimmed) || (address ?? '').toLowerCase().includes(trimmed);
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
    storeys?: number;
    features?: string[];
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
    storeys?: number;
    features?: string[];
    price?: number;
    price_currency?: string;
    status?: PropertyStatus;
    lease_monthly_amount?: number;
    lease_term_months?: number;
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
    listing_type: 'sale' | 'lease';
    price: number;
    exclusivity?: 'exclusive' | 'open';
    authority_starts_at?: string;
    authority_expires_at?: string | null;
  },
  // tb-listings-property-specs-001: listings now insert directly as 'active',
  // so the same exclusivity conflict-check activation already ran can now
  // fire on creation too -- `warning` mirrors updateListingStatus's own
  // optional field for the identical non-blocking case.
): Promise<Listing & { warning?: string }> {
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

// tb-listings-detail-edit-modal-001: edits price/listing_type/exclusivity on
// an existing listing -- none of these were changeable post-creation before
// this. Independent of a status transition; shares the same PATCH route as
// updateListingStatus (the backend accepts either or both in one request),
// but this helper never sends a status field.
export async function updateListingFields(
  accessToken: string,
  listingId: string,
  fields: Partial<Pick<Listing, 'listing_type' | 'price' | 'exclusivity'>>,
): Promise<Listing> {
  const response = await fetch(`${BACKEND_URL}/listings/${listingId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fields),
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

// tb-listings-docket-shares-panel-001: hoisted out of SharedWithMePage.tsx so
// DocketSharesPanel.tsx can reuse the same human-readable labels/formatting
// instead of duplicating them.
export const DOCKET_FIELD_LABELS: Record<string, string> = {
  listing_type: 'Listing type',
  price: 'Price',
  price_currency: 'Currency',
  exclusivity: 'Exclusivity',
  authority_starts_at: 'Authority starts',
  authority_expires_at: 'Authority ends',
  status: 'Status',
  title: 'Title',
  type: 'Property type',
  address: 'Address',
  city: 'City',
  province: 'Province',
  floor_area_sqm: 'Floor area (sqm)',
  lot_area_sqm: 'Lot area (sqm)',
  bedrooms: 'Bedrooms',
  bathrooms: 'Bathrooms',
  parking_slots: 'Parking slots',
};

export function formatDocketFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'price' && typeof value === 'number') {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(value);
}

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

export type SentDocket = {
  id: string;
  shared_with_handle: string | null;
  included_fields: DocketField[];
  created_at: string;
};

export async function fetchSentDockets(accessToken: string, listingId: string): Promise<{ dockets: SentDocket[] }> {
  const response = await fetch(`${BACKEND_URL}/listings/${listingId}/dockets`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}
