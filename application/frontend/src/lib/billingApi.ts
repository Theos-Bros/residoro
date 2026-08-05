const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type ContractBilling = {
  contract_value: number;
  currency: string;
  updated_at: string;
};

export type BillingInstallment = {
  id: string;
  amount: number;
  currency: string;
  due_date: string;
  status: 'unpaid' | 'paid';
  paid_date: string | null;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

// tb-billing-brokerage-view-001: reads GET /workspace/billing -- the
// tenant-admin-facing, RLS-scoped route (distinct from the operator-only
// /admin/clients/:id/billing... routes adminApi.ts's fetchBilling hits).
export async function fetchWorkspaceBilling(
  accessToken: string,
): Promise<{ contract_billing: ContractBilling | null; installments: BillingInstallment[] }> {
  const response = await fetch(`${BACKEND_URL}/workspace/billing`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}
