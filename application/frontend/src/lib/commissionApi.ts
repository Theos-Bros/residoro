const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type CommissionSettings = {
  default_brokerage_pct: number;
  default_agent_pct: number;
  default_co_broker_pct: number;
  can_edit: boolean;
};

export type CommissionEarnings = {
  id: string;
  tenant_id: string;
  closing_id: string;
  total_commission: number;
  currency: string;
  brokerage_pct: number;
  agent_pct: number;
  co_broker_pct: number;
  brokerage_amount: number;
  agent_amount: number;
  co_broker_amount: number;
  computed_at: string;
  created_by: string | null;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchCommissionSettings(accessToken: string): Promise<CommissionSettings> {
  const response = await fetch(`${BACKEND_URL}/settings/commission`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function updateCommissionSettings(
  accessToken: string,
  input: { default_brokerage_pct: number; default_agent_pct: number; default_co_broker_pct: number },
): Promise<CommissionSettings> {
  const response = await fetch(`${BACKEND_URL}/settings/commission`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function fetchClosingCommissionEarnings(
  accessToken: string,
  closingId: string,
): Promise<{ commission_earnings: CommissionEarnings | null }> {
  const response = await fetch(`${BACKEND_URL}/closings/${closingId}/commission-earnings`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function recordCommissionEarnings(
  accessToken: string,
  input: { closing_id: string; total_commission: number; currency?: string },
): Promise<CommissionEarnings> {
  const response = await fetch(`${BACKEND_URL}/commission-earnings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}
