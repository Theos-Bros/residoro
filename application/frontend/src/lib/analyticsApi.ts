const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type ShareAudience = 'public' | 'co_broker' | 'internal';

export type ListingPerformance = {
  listing_id: string;
  title: string;
  share_count_30d: number;
  hot: boolean;
};

export type PerformanceSettings = {
  hot_share_threshold: number;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

// Fire-and-forget from the caller's perspective (ShareDetailsModal swallows
// the rejection) -- this function itself still throws on failure so the
// caller controls that behavior rather than silently double-handling it.
export async function logShareEvent(accessToken: string, listingId: string, audience: ShareAudience): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/listings/${listingId}/share-events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audience }),
  });
  await parseJsonOrThrow(response);
}

export async function fetchListingsPerformance(accessToken: string): Promise<{ listings: ListingPerformance[] }> {
  const response = await fetch(`${BACKEND_URL}/listings/performance`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchPerformanceSettings(accessToken: string): Promise<PerformanceSettings> {
  const response = await fetch(`${BACKEND_URL}/settings/performance`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function updatePerformanceSettings(
  accessToken: string,
  hotShareThreshold: number,
): Promise<PerformanceSettings> {
  const response = await fetch(`${BACKEND_URL}/settings/performance`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ hot_share_threshold: hotShareThreshold }),
  });
  return parseJsonOrThrow(response);
}
