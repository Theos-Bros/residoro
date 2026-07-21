const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type AccessState = 'active' | 'read_only' | 'blocked';
export type WarningTier = '30d' | '7d' | '1d';

export type ContractNotification = {
  id: string;
  threshold: WarningTier;
  message: string;
  created_at: string;
};

export type WorkspaceStatus = {
  access_state: AccessState;
  contract_end_date: string;
  active_warning: WarningTier | null;
  notifications: ContractNotification[];
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchWorkspaceStatus(accessToken: string): Promise<WorkspaceStatus> {
  const response = await fetch(`${BACKEND_URL}/me/workspace-status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function dismissNotification(accessToken: string, id: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/me/notifications/${id}/dismiss`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await parseJsonOrThrow(response);
}
