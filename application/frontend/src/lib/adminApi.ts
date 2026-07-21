const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type Whoami = {
  id: string;
  role: 'operator';
};

export type Client = {
  workspace_id: string;
  brokerage_name: string;
  contract_start_date: string;
  contract_end_date: string;
  invite_status: 'pending' | 'accepted';
};

export type NewClientInput = {
  brokerage_name: string;
  admin_email: string;
  contract_start_date: string;
  contract_end_date: string;
};

// Returns null (rather than throwing) for a non-operator/expired session --
// callers use this to decide whether to render the admin dashboard or
// redirect away, not to distinguish *why* it failed.
export async function fetchWhoami(accessToken: string): Promise<Whoami | null> {
  const response = await fetch(`${BACKEND_URL}/admin/whoami`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchClients(accessToken: string): Promise<{ clients: Client[] }> {
  const response = await fetch(`${BACKEND_URL}/admin/clients`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function createClient(
  accessToken: string,
  input: NewClientInput,
): Promise<{ workspace_id: string; status: string; invite_status: string }> {
  const response = await fetch(`${BACKEND_URL}/admin/clients`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}
