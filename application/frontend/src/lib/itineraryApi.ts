const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type ItinerarySettings = {
  recipient_email: string | null;
  drive_folder_id: string | null;
  template_document_id: string | null;
  service_account_email: string | null;
  can_edit: boolean;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchItinerarySettings(accessToken: string): Promise<ItinerarySettings> {
  const response = await fetch(`${BACKEND_URL}/settings/itinerary`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function updateItinerarySettings(
  accessToken: string,
  input: { recipient_email?: string | null; drive_folder_id?: string | null; template_document_id?: string | null },
): Promise<ItinerarySettings> {
  const response = await fetch(`${BACKEND_URL}/settings/itinerary`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}
