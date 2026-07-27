const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type Contact = {
  id: string;
  name: string;
  type: string;
  company: string | null;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchContacts(accessToken: string): Promise<{ contacts: Contact[] }> {
  const response = await fetch(`${BACKEND_URL}/contacts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}
