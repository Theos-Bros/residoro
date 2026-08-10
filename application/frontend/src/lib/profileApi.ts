const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type Profile = {
  first_name: string | null;
  last_name: string | null;
  prefix: string | null;
  position: string | null;
  handle: string | null;
  email: string | null;
};

export type ProfileUpdate = {
  first_name: string;
  last_name?: string | null;
  prefix?: string | null;
  position?: string | null;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

// tb-user-profile-display-name-001: /me/profile is served by requireAnyIdentity,
// so this works identically for a tenant user (brokerage app) and an operator
// (admin dashboard) -- same route, same shape, no role branching here.
export async function fetchProfile(accessToken: string): Promise<Profile> {
  const response = await fetch(`${BACKEND_URL}/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function updateProfile(accessToken: string, update: ProfileUpdate): Promise<Profile> {
  const response = await fetch(`${BACKEND_URL}/me/profile`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(update),
  });
  return parseJsonOrThrow(response);
}
