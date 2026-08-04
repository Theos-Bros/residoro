const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type ViewingOutcome = 'scheduled' | 'completed' | 'no_show' | 'cancelled';

export const VIEWING_OUTCOMES: readonly ViewingOutcome[] = ['scheduled', 'completed', 'no_show', 'cancelled'];

export type Viewing = {
  id: string;
  tenant_id: string;
  buyer_requirement_id: string;
  listing_id: string;
  scheduled_at: string;
  outcome: ViewingOutcome;
  feedback: string | null;
  created_at: string;
  updated_at: string;
  // tb-calendar-schedule-001: only populated by GET /viewings' tenant-wide
  // join -- the scoped per-Lead/per-listing endpoints don't select these.
  // `listings.property_title` isn't a real column (see listings.ts) -- the
  // title lives on the joined `properties` row instead.
  buyer_requirements?: { contacts: { name: string } | null } | null;
  listings?: { properties: { title: string } | null } | null;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchViewings(
  accessToken: string,
  filters?: { outcome?: ViewingOutcome; scheduled_before?: string; scheduled_after?: string },
): Promise<{ viewings: Viewing[] }> {
  const params = new URLSearchParams();
  if (filters?.outcome) params.set('outcome', filters.outcome);
  if (filters?.scheduled_before) params.set('scheduled_before', filters.scheduled_before);
  if (filters?.scheduled_after) params.set('scheduled_after', filters.scheduled_after);
  const query = params.toString();
  const response = await fetch(`${BACKEND_URL}/viewings${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchLeadViewings(accessToken: string, leadId: string): Promise<{ viewings: Viewing[] }> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${leadId}/viewings`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchListingViewings(accessToken: string, listingId: string): Promise<{ viewings: Viewing[] }> {
  const response = await fetch(`${BACKEND_URL}/listings/${listingId}/viewings`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function scheduleViewing(
  accessToken: string,
  input: { buyer_requirement_id: string; listing_id: string; scheduled_at: string },
): Promise<Viewing> {
  const response = await fetch(`${BACKEND_URL}/viewings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function updateViewing(
  accessToken: string,
  id: string,
  patch: { outcome?: ViewingOutcome; feedback?: string; scheduled_at?: string },
): Promise<Viewing> {
  const response = await fetch(`${BACKEND_URL}/viewings/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return parseJsonOrThrow(response);
}
