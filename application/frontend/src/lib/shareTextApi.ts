const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type ShareAudience = 'public' | 'co_broker' | 'internal';

export type ShareTemplates = {
  public_share_template: string | null;
  co_broker_share_template: string | null;
  can_edit: boolean;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchShareTemplates(accessToken: string): Promise<ShareTemplates> {
  const response = await fetch(`${BACKEND_URL}/settings/share-templates`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function updateShareTemplates(
  accessToken: string,
  input: Partial<ShareTemplates>,
): Promise<ShareTemplates> {
  const response = await fetch(`${BACKEND_URL}/settings/share-templates`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function fetchShareText(
  accessToken: string,
  listingId: string,
  audience: ShareAudience,
): Promise<{ text: string }> {
  const response = await fetch(`${BACKEND_URL}/listings/${listingId}/share-text?audience=${audience}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}
