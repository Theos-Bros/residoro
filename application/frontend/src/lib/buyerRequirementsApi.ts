import type { Intent, RequirementFields, RequirementPropertyType } from './inquiriesApi';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type LeadStage =
  | 'registered'
  | 'searching'
  | 'stalled'
  | 'options_sent'
  | 'viewing'
  | 'negotiating'
  | 'contract_closing'
  | 'won'
  | 'lost';

export const LEAD_STAGES: readonly LeadStage[] = [
  'registered',
  'searching',
  'stalled',
  'options_sent',
  'viewing',
  'negotiating',
  'contract_closing',
  'won',
  'lost',
];

export type BuyerRequirementMatch = {
  id: string;
  listing_id: string;
  score: number | null;
  sent_at: string;
};

export type BuyerRequirement = RequirementFields & {
  id: string;
  tenant_id: string;
  contact_id: string;
  source_inquiry_id: string | null;
  stage: LeadStage;
  last_searched_at: string | null;
  won_listing_id: string | null;
  // tb-buyer-leads-revisit-page-001: only ever non-null for a lease-type won
  // listing -- see mark-won's server-side validation in buyerRequirements.ts.
  lease_end_date: string | null;
  created_at: string;
  updated_at: string;
  contacts: { name: string } | null;
  buyer_requirement_matches?: BuyerRequirementMatch[];
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchBuyerRequirements(
  accessToken: string,
  opts?: { stage?: LeadStage },
): Promise<{ buyer_requirements: BuyerRequirement[] }> {
  const params = new URLSearchParams();
  if (opts?.stage) params.set('stage', opts.stage);
  const query = params.toString();
  const response = await fetch(`${BACKEND_URL}/buyer-requirements${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchBuyerRequirement(accessToken: string, id: string): Promise<BuyerRequirement> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function createBuyerRequirement(
  accessToken: string,
  input: RequirementFields & (
    | { contact_id: string; create_contact?: never }
    | { create_contact: { name: string; phone?: string; email?: string }; contact_id?: never }
  ),
): Promise<BuyerRequirement> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function updateBuyerRequirement(
  accessToken: string,
  id: string,
  patch: RequirementFields & { stage?: LeadStage },
): Promise<BuyerRequirement> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return parseJsonOrThrow(response);
}

export async function sendOptions(
  accessToken: string,
  id: string,
  listingIds: string[],
  scores?: Record<string, number>,
): Promise<{ buyer_requirement: BuyerRequirement; matches: BuyerRequirementMatch[] }> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${id}/options-sent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ listing_ids: listingIds, scores }),
  });
  return parseJsonOrThrow(response);
}

export async function markWon(
  accessToken: string,
  id: string,
  listingId: string,
  leaseEndDate?: string,
): Promise<BuyerRequirement> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${id}/mark-won`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ listing_id: listingId, lease_end_date: leaseEndDate }),
  });
  return parseJsonOrThrow(response);
}

// tb-buyer-leads-revisit-page-001: a won lead's own lease term (client-facing),
// captured on mark-won when the won listing is lease-type. Deliberately unrelated
// to tb-properties-unit-leasing-001's properties.status='leased' (a developer's
// own unit inventory) -- same word, two different concepts, no shared schema.
export type RevisitLead = {
  id: string;
  lease_end_date: string;
  contacts: { name: string } | null;
  listing: {
    listing_type: 'sale' | 'lease';
    price: number;
    price_currency: string;
    properties: { title: string; address: string | null; city: string | null; province: string | null } | null;
  } | null;
};

export async function fetchRevisitLeads(accessToken: string): Promise<{ revisit_leads: RevisitLead[] }> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/revisit`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export type { Intent, RequirementFields, RequirementPropertyType };
