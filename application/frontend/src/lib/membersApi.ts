const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type WorkspaceMember = {
  id: string;
  full_name: string | null;
  handle: string | null;
  role: string;
  created_at: string;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchMembers(accessToken: string): Promise<{ members: WorkspaceMember[] }> {
  const response = await fetch(`${BACKEND_URL}/workspace/members`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function inviteMember(
  accessToken: string,
  params: { email: string; full_name?: string },
): Promise<{ id: string; email: string; status: 'invited' | 'added' }> {
  const response = await fetch(`${BACKEND_URL}/workspace/members`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow(response);
}

export async function removeMember(accessToken: string, memberId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/workspace/members/${memberId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await parseJsonOrThrow(response);
}
