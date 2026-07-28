const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type BroadcastEntityType = 'inquiry' | 'buyer_requirement';

const ENTITY_PATH: Record<BroadcastEntityType, string> = {
  inquiry: 'inquiries',
  buyer_requirement: 'buyer-requirements',
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchBroadcastText(
  accessToken: string,
  entityType: BroadcastEntityType,
  entityId: string,
): Promise<{ text: string | null; template_configured: boolean }> {
  const response = await fetch(`${BACKEND_URL}/${ENTITY_PATH[entityType]}/${entityId}/broadcast-text`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}
