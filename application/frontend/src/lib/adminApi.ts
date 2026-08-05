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
  access_state: 'active' | 'read_only' | 'blocked';
  invite_status: 'pending' | 'accepted';
  exclusivity_hard_block: boolean;
  rollback_window_hours: number;
};

export type NewClientInput = {
  brokerage_name: string;
  admin_email: string;
  contract_start_date: string;
  contract_end_date: string;
};

export type TrainingSession = {
  id: string;
  workspace_id: string;
  brokerage_name: string;
  session_number: 1 | 2;
  scheduled_date: string;
  status: 'scheduled' | 'completed' | 'missed';
  completed_at: string | null;
  overdue: boolean;
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

export async function extendContract(
  accessToken: string,
  workspaceId: string,
  contractEndDate: string,
): Promise<{ workspace_id: string; contract_end_date: string }> {
  const response = await fetch(`${BACKEND_URL}/admin/clients/${workspaceId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ contract_end_date: contractEndDate }),
  });
  return parseJsonOrThrow(response);
}

// tb-listings-exclusivity-hardblock-001: operator-only toggle. Default is
// soft-warning (false) for every workspace unless an operator opts one in.
export async function setExclusivityHardBlock(
  accessToken: string,
  workspaceId: string,
  exclusivityHardBlock: boolean,
): Promise<{ workspace_id: string; exclusivity_hard_block: boolean }> {
  const response = await fetch(`${BACKEND_URL}/admin/clients/${workspaceId}/listings-policy`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ exclusivity_hard_block: exclusivityHardBlock }),
  });
  return parseJsonOrThrow(response);
}

// tb-migration-rollback-window-001: operator-only override. Default (24)
// preserves tb-migration-rollback-001's existing fixed-window behavior for
// every workspace unless an operator explicitly sets a different value; only
// affects import batches created after the change.
export async function setRollbackWindowHours(
  accessToken: string,
  workspaceId: string,
  rollbackWindowHours: number,
): Promise<{ workspace_id: string; rollback_window_hours: number }> {
  const response = await fetch(`${BACKEND_URL}/admin/clients/${workspaceId}/rollback-policy`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rollback_window_hours: rollbackWindowHours }),
  });
  return parseJsonOrThrow(response);
}

export async function scheduleTraining(
  accessToken: string,
  workspaceId: string,
  session1Date: string,
  session2Date: string,
): Promise<{ workspace_id: string; sessions: unknown[] }> {
  const response = await fetch(`${BACKEND_URL}/admin/clients/${workspaceId}/training`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session_1_date: session1Date, session_2_date: session2Date }),
  });
  return parseJsonOrThrow(response);
}

export async function updateTrainingStatus(
  accessToken: string,
  sessionId: string,
  status: 'completed' | 'missed',
): Promise<{ id: string; status: string; completed_at: string | null }> {
  const response = await fetch(`${BACKEND_URL}/admin/training/${sessionId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });
  return parseJsonOrThrow(response);
}

export async function fetchTrainingOverview(accessToken: string): Promise<{ sessions: TrainingSession[] }> {
  const response = await fetch(`${BACKEND_URL}/admin/training`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

// tb-billing-installments-001
export type ContractBilling = {
  tenant_id: string;
  contract_value: number;
  currency: string;
  created_at: string;
  updated_at: string;
};

export type BillingInstallment = {
  id: string;
  amount: number;
  currency: string;
  due_date: string;
  status: 'unpaid' | 'paid';
  paid_date: string | null;
  created_at: string;
  updated_at: string;
};

export async function fetchBilling(
  accessToken: string,
  workspaceId: string,
): Promise<{ contract_billing: ContractBilling | null; installments: BillingInstallment[] }> {
  const response = await fetch(`${BACKEND_URL}/admin/clients/${workspaceId}/billing`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function setContractBilling(
  accessToken: string,
  workspaceId: string,
  contractValue: number,
  currency: string,
): Promise<ContractBilling> {
  const response = await fetch(`${BACKEND_URL}/admin/clients/${workspaceId}/billing`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ contract_value: contractValue, currency }),
  });
  return parseJsonOrThrow(response);
}

export async function createInstallment(
  accessToken: string,
  workspaceId: string,
  amount: number,
  currency: string,
  dueDate: string,
): Promise<BillingInstallment> {
  const response = await fetch(`${BACKEND_URL}/admin/clients/${workspaceId}/billing/installments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount, currency, due_date: dueDate }),
  });
  return parseJsonOrThrow(response);
}

export async function updateInstallment(
  accessToken: string,
  workspaceId: string,
  installmentId: string,
  updates: { amount?: number; due_date?: string; status?: 'unpaid' | 'paid'; paid_date?: string },
): Promise<BillingInstallment> {
  const response = await fetch(`${BACKEND_URL}/admin/clients/${workspaceId}/billing/installments/${installmentId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });
  return parseJsonOrThrow(response);
}

export async function deleteInstallment(accessToken: string, workspaceId: string, installmentId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/admin/clients/${workspaceId}/billing/installments/${installmentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
}
