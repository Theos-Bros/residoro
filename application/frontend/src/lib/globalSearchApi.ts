const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type GlobalSearchEntityType = 'property' | 'listing' | 'contact' | 'lead' | 'inquiry' | 'task' | 'project';

export type GlobalSearchResult = {
  entity_type: GlobalSearchEntityType;
  entity_id: string;
  title: string;
  subtitle: string | null;
  rank: number;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

// tb-search-core-entities-001: named /global-search, not /search -- POST
// /search already exists for cap-buyer-leads-001's unrelated matching search.
export async function globalSearch(accessToken: string, q: string): Promise<{ results: GlobalSearchResult[] }> {
  const response = await fetch(`${BACKEND_URL}/global-search?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}
