const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

// tb-buyer-leads-match-itinerary-001: an item is EITHER a listing_id
// (inventory- or docket-sourced) OR a property_id (a project-linked unit
// with no Listing yet) -- mirrors matchCandidates.ts's backend contract and
// SearchPage's MatchResult shape, where a project_unit result's "listing_id"
// field actually holds a properties.id.
export type MatchItemInput = { listing_id: string } | { property_id: string };

export type MatchLogItem = {
  id: string;
  listing_id: string | null;
  property_id: string | null;
  title: string;
};

export type MatchLog = {
  id: string;
  created_at: string;
  logged_by: string | null;
  logged_by_handle?: string | null;
  items: MatchLogItem[];
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchMatchLogs(accessToken: string, leadId: string): Promise<{ match_logs: MatchLog[] }> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${leadId}/match-logs`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function logMatch(
  accessToken: string,
  leadId: string,
  items: MatchItemInput[],
): Promise<{ match_log: MatchLog }> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${leadId}/match-logs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  return parseJsonOrThrow(response);
}

export async function fetchMatchCopyText(
  accessToken: string,
  leadId: string,
  items: MatchItemInput[],
): Promise<{ text: string }> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${leadId}/match-copy-text`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  return parseJsonOrThrow(response);
}

export async function generateItinerary(
  accessToken: string,
  leadId: string,
  items: MatchItemInput[],
): Promise<{ document_id: string; url: string }> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${leadId}/itinerary`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  return parseJsonOrThrow(response);
}
