const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type SigningStatus = 'drafted' | 'sent' | 'signed' | 'void';

export type Contract = {
  id: string;
  tenant_id: string;
  buyer_requirement_id: string;
  listing_id: string;
  offer_id: string;
  agreed_price: number;
  currency: string;
  terms: string | null;
  signing_status: SigningStatus;
  signed_at: string | null;
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

export async function fetchLeadContract(accessToken: string, leadId: string): Promise<{ contract: Contract | null }> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${leadId}/contract`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchListingContract(accessToken: string, listingId: string): Promise<{ contract: Contract | null }> {
  const response = await fetch(`${BACKEND_URL}/listings/${listingId}/contract`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function createContract(
  accessToken: string,
  input: { offer_id: string; agreed_price?: number; currency?: string; terms?: string },
): Promise<Contract> {
  const response = await fetch(`${BACKEND_URL}/contracts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function updateContract(
  accessToken: string,
  id: string,
  input: { agreed_price?: number; currency?: string; terms?: string; signing_status?: SigningStatus },
): Promise<Contract> {
  const response = await fetch(`${BACKEND_URL}/contracts/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}
