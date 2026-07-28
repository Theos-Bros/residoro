const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type Contact = {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  is_company: boolean;
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

export async function fetchContacts(accessToken: string, opts?: { isCompany?: boolean }): Promise<{ contacts: Contact[] }> {
  const params = new URLSearchParams();
  if (opts?.isCompany !== undefined) params.set('is_company', String(opts.isCompany));
  const query = params.toString();
  const response = await fetch(`${BACKEND_URL}/contacts${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchContact(accessToken: string, id: string): Promise<Contact> {
  const response = await fetch(`${BACKEND_URL}/contacts/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function createContact(
  accessToken: string,
  input: {
    name: string;
    type: string;
    is_company?: boolean;
    email?: string;
    phone?: string;
    company?: string;
    notes?: string;
  },
): Promise<Contact> {
  const response = await fetch(`${BACKEND_URL}/contacts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function updateContact(
  accessToken: string,
  id: string,
  patch: Partial<{
    name: string;
    type: string;
    is_company: boolean;
    email: string;
    phone: string;
    company: string;
    notes: string;
  }>,
): Promise<Contact> {
  const response = await fetch(`${BACKEND_URL}/contacts/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return parseJsonOrThrow(response);
}

export async function deleteContact(accessToken: string, id: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/contacts/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
}
