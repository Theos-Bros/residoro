const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type Whoami = {
  id: string;
  role: 'operator';
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
