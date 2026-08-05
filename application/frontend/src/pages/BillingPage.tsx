import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchWorkspaceBilling, type BillingInstallment, type ContractBilling } from '@/lib/billingApi';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Props = {
  session: Session;
};

// tb-billing-brokerage-view-001: read-only. The tenant's own admin can see
// their contract value + every installment's status/history, reading
// through the RLS SELECT policy tb-billing-installments-001 shipped but
// left unused. Non-admin members never reach this page -- BrokerageLayout
// hides the nav entry, and GET /workspace/billing 403s at the app level
// (backed by RLS as the real enforcement) if reached directly. No write
// controls anywhere -- all writes stay operator-only via ClientBilling.tsx.
export function BillingPage({ session }: Props) {
  const [contractBilling, setContractBilling] = useState<ContractBilling | null | undefined>(undefined);
  const [installments, setInstallments] = useState<BillingInstallment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchWorkspaceBilling(session.access_token)
      .then(({ contract_billing, installments }) => {
        if (cancelled) return;
        setContractBilling(contract_billing);
        setInstallments(installments);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [session.access_token]);

  const loading = contractBilling === undefined && !error;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && !error && contractBilling === null && (
        <p className="text-sm text-muted-foreground">No billing record has been set up for your workspace yet.</p>
      )}

      {!loading && !error && contractBilling && (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Contract value</p>
          <p className="text-lg font-medium text-foreground">
            {contractBilling.currency} {contractBilling.contract_value.toLocaleString()}
          </p>
        </div>
      )}

      {!loading && !error && installments.length === 0 && (
        <p className="text-sm text-muted-foreground">No installments yet.</p>
      )}

      {!loading && !error && installments.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Due date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Paid date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {installments.map((installment) => (
                <TableRow key={installment.id}>
                  <TableCell>{installment.due_date}</TableCell>
                  <TableCell>
                    {installment.currency} {installment.amount.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={installment.status === 'paid' ? 'secondary' : 'outline'}>
                      {installment.status === 'paid' ? 'Paid' : 'Unpaid'}
                    </Badge>
                  </TableCell>
                  <TableCell>{installment.paid_date ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
