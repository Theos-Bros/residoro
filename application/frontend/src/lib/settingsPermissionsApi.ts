const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type SettingKey = 'sharing_templates' | 'performance' | 'matching';

export type MemberPermissions = {
  member_id: string;
  full_name: string;
  handle: string | null;
  sharing_templates: boolean;
  performance: boolean;
  matching: boolean;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchMemberPermissions(accessToken: string): Promise<{ members: MemberPermissions[] }> {
  const response = await fetch(`${BACKEND_URL}/settings/permissions`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function setMemberPermission(
  accessToken: string,
  memberId: string,
  settingKey: SettingKey,
  granted: boolean,
): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/settings/permissions/${memberId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ setting_key: settingKey, granted }),
  });
  await parseJsonOrThrow(response);
}
