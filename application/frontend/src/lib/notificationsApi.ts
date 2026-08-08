const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type Notification = {
  id: string;
  tenant_id: string;
  recipient_id: string | null;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchNotifications(accessToken: string): Promise<{ notifications: Notification[] }> {
  const response = await fetch(`${BACKEND_URL}/notifications`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function dismissNotification(accessToken: string, id: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/notifications/${id}/dismiss`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await parseJsonOrThrow(response);
}
