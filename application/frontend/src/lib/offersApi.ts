const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type OfferedBy = 'buyer' | 'seller';
export type OfferStatus = 'pending' | 'countered' | 'accepted' | 'rejected' | 'withdrawn';

export const OFFERED_BY_VALUES: readonly OfferedBy[] = ['buyer', 'seller'];

export type Offer = {
  id: string;
  tenant_id: string;
  buyer_requirement_id: string;
  listing_id: string;
  offered_by: OfferedBy;
  amount: number;
  currency: string;
  terms: string | null;
  status: OfferStatus;
  supersedes_offer_id: string | null;
  created_at: string;
  updated_at: string;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchLeadOffers(accessToken: string, leadId: string): Promise<{ offers: Offer[] }> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${leadId}/offers`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchListingOffers(accessToken: string, listingId: string): Promise<{ offers: Offer[] }> {
  const response = await fetch(`${BACKEND_URL}/listings/${listingId}/offers`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function recordOffer(
  accessToken: string,
  input: {
    buyer_requirement_id: string;
    listing_id: string;
    offered_by: OfferedBy;
    amount: number;
    currency?: string;
    terms?: string;
    supersedes_offer_id?: string;
  },
): Promise<Offer> {
  const response = await fetch(`${BACKEND_URL}/offers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function resolveOffer(
  accessToken: string,
  id: string,
  status: 'accepted' | 'rejected' | 'withdrawn',
): Promise<Offer> {
  const response = await fetch(`${BACKEND_URL}/offers/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return parseJsonOrThrow(response);
}
