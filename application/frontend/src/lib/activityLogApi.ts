const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type ActivityType = 'call' | 'email' | 'meeting' | 'note' | 'other';

export const ACTIVITY_TYPES: readonly ActivityType[] = ['call', 'email', 'meeting', 'note', 'other'];

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  other: 'Other',
};

export type ActivityLogEntry = {
  id: string;
  activity_type: ActivityType;
  notes: string | null;
  occurred_at: string;
  logged_by: string | null;
  logged_by_handle?: string | null;
  created_at: string;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchActivityLog(
  accessToken: string,
  leadId: string,
): Promise<{ activity_log: ActivityLogEntry[] }> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${leadId}/activity-log`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function logActivity(
  accessToken: string,
  leadId: string,
  input: { activity_type: ActivityType; notes?: string; occurred_at?: string },
): Promise<{ activity: ActivityLogEntry }> {
  const response = await fetch(`${BACKEND_URL}/buyer-requirements/${leadId}/activity-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}
