import type { RequirementFields } from './inquiriesApi';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type MatchableField = 'intent' | 'property_type' | 'budget' | 'location' | 'bedrooms' | 'bathrooms' | 'area';

// Toggle-able in the UI; `intent` is always hard and never offered as a
// checkbox -- mirrors matching.ts's TOGGLE_FIELDS on the backend.
export const TOGGLE_FIELDS: readonly Exclude<MatchableField, 'intent'>[] = [
  'property_type',
  'budget',
  'location',
  'bedrooms',
  'bathrooms',
  'area',
];

export const TOGGLE_FIELD_LABELS: Record<Exclude<MatchableField, 'intent'>, string> = {
  property_type: 'Property type',
  budget: 'Budget',
  location: 'Location',
  bedrooms: 'Bedrooms',
  bathrooms: 'Bathrooms',
  area: 'Floor / lot area',
};

export type MatchResult = {
  source: 'inventory' | 'docket' | 'project_unit';
  listing_id: string;
  docket_id?: string;
  shared_by_handle?: string | null;
  property_title: string | null;
  price: number | null;
  price_currency: string | null;
  score: number;
  matched_fields: MatchableField[];
  excluded_fields: MatchableField[];
};

export type MatchingSettings = {
  match_score_threshold: number;
  can_edit: boolean;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function searchInquiry(
  accessToken: string,
  inquiryId: string,
  hardFilterFields: Exclude<MatchableField, 'intent'>[],
): Promise<{ results: MatchResult[] }> {
  const response = await fetch(`${BACKEND_URL}/inquiries/${inquiryId}/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hard_filter_fields: hardFilterFields }),
  });
  return parseJsonOrThrow(response);
}

export async function searchBuyerRequirement(
  accessToken: string,
  leadId: string,
  hardFilterFields: Exclude<MatchableField, 'intent'>[],
): Promise<{ results: MatchResult[] }> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${leadId}/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hard_filter_fields: hardFilterFields }),
  });
  return parseJsonOrThrow(response);
}

export async function searchAdHoc(
  accessToken: string,
  requirement: RequirementFields,
  hardFilterFields: Exclude<MatchableField, 'intent'>[],
): Promise<{ results: MatchResult[] }> {
  const response = await fetch(`${BACKEND_URL}/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requirement, hard_filter_fields: hardFilterFields }),
  });
  return parseJsonOrThrow(response);
}

export async function fetchMatchingSettings(accessToken: string): Promise<MatchingSettings> {
  const response = await fetch(`${BACKEND_URL}/settings/matching`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function updateMatchingSettings(accessToken: string, matchScoreThreshold: number): Promise<MatchingSettings> {
  const response = await fetch(`${BACKEND_URL}/settings/matching`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ match_score_threshold: matchScoreThreshold }),
  });
  return parseJsonOrThrow(response);
}

export type { RequirementFields };
