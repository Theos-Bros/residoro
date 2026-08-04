const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type Closing = {
  id: string;
  tenant_id: string;
  contract_id: string;
  buyer_requirement_id: string;
  listing_id: string;
  final_price: number;
  currency: string;
  checklist_state: Record<string, unknown>;
  completed_at: string | null;
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

export async function fetchLeadClosing(accessToken: string, leadId: string): Promise<{ closing: Closing | null }> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${leadId}/closing`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchListingClosing(accessToken: string, listingId: string): Promise<{ closing: Closing | null }> {
  const response = await fetch(`${BACKEND_URL}/listings/${listingId}/closing`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function createClosing(accessToken: string, contractId: string): Promise<Closing> {
  const response = await fetch(`${BACKEND_URL}/closings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contract_id: contractId }),
  });
  return parseJsonOrThrow(response);
}

export async function updateClosing(
  accessToken: string,
  id: string,
  input: { final_price?: number; currency?: string; completed?: boolean; lease_end_date?: string },
): Promise<Closing> {
  const response = await fetch(`${BACKEND_URL}/closings/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}
