import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchBilling, type BillingInstallment, type ContractBilling } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Props = {
  session: Session;
};

// tb-billing-invoice-generation-001: the one piece of cap-billing-001's v1
// scope not yet built -- a document the operator can hand the client outside
// Residoro. Deliberately a standalone route OUTSIDE AdminLayout (see
// AdminApp.tsx: this route sits as a sibling of the AdminLayout route, not
// nested under it) so nothing but the invoice itself ever hits the page --
// no dashboard header/nav to fight with `@media print`, no CSS hacks to hide
// chrome. Mechanism: browser print-to-PDF (window.print()), not a PDF
// library or a backend-generated file -- no PDF-generation dependency
// exists anywhere in residoro today, and cap-deployment-001 just pinned
// hosting to Render tiers that don't reliably support a headless-Chromium
// install. Zero new dependencies, zero new deploy risk.
//
// Reuses the existing GET /admin/clients/:id/billing fetch (now also
// returning brokerage_name, additively) rather than threading data through
// route state -- this route is meant to be safely reloadable/shareable
// (operator might open it, print, close, reopen) without depending on
// ClientBilling.tsx still being mounted.
export function InvoiceView({ session }: Props) {
  const { tenantId, installmentId } = useParams<{ tenantId: string; installmentId: string }>();
  const [brokerageName, setBrokerageName] = useState<string | null>(null);
  const [contractBilling, setContractBilling] = useState<ContractBilling | null>(null);
  const [installment, setInstallment] = useState<BillingInstallment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !installmentId) {
      setError('Missing client or installment.');
      setLoading(false);
      return;
    }
    fetchBilling(session.access_token, tenantId)
      .then(({ brokerage_name, contract_billing, installments }) => {
        setBrokerageName(brokerage_name);
        setContractBilling(contract_billing);
        const found = installments.find((i) => i.id === installmentId) ?? null;
        if (!found) {
          setError('That installment no longer exists.');
        }
        setInstallment(found);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [session.access_token, tenantId, installmentId]);

  if (loading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }

  if (error || !installment) {
    return (
      <div className="p-6 space-y-4">
        <p role="alert" className="text-sm text-destructive">
          {error ?? 'Could not load this installment.'}
        </p>
        <Link to={`/admin/clients/${tenantId}/billing`} className="text-sm underline">
          Back to billing
        </Link>
      </div>
    );
  }

  const generatedOn = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-muted/30 print:bg-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between py-4 print:hidden">
        <Link to={`/admin/clients/${tenantId}/billing`} className="text-sm text-muted-foreground underline">
          &larr; Back to billing
        </Link>
        <Button onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>

      <div className="mx-auto max-w-2xl bg-background p-10 shadow-sm print:shadow-none print:p-0">
        <div className="flex items-start justify-between border-b pb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Residoro</h1>
            <p className="text-sm text-muted-foreground">Invoice</p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <p>Generated {generatedOn}</p>
            <p>Installment {installment.id.slice(0, 8)}</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-6">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Billed to</h2>
            <p className="mt-1 text-base font-medium">{brokerageName}</p>
          </div>
          <div className="text-right">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contract value</h2>
            <p className="mt-1 text-base font-medium">
              {contractBilling ? `${contractBilling.currency} ${contractBilling.contract_value.toLocaleString()}` : '—'}
            </p>
          </div>
        </div>

        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2">Description</th>
              <th className="pb-2">Due date</th>
              <th className="pb-2">Status</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className="py-3">Contract installment</td>
              <td className="py-3">{installment.due_date}</td>
              <td className="py-3">
                <Badge variant={installment.status === 'paid' ? 'success' : 'warning'}>
                  {installment.status === 'paid' ? `Paid ${installment.paid_date ?? ''}` : 'Unpaid'}
                </Badge>
              </td>
              <td className="py-3 text-right font-medium">
                {installment.currency} {installment.amount.toLocaleString()}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-4 text-right font-medium">
                Total due
              </td>
              <td className="pt-4 text-right text-base font-semibold">
                {installment.currency} {installment.amount.toLocaleString()}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-10 text-xs text-muted-foreground">
          This document was generated by Residoro on behalf of your brokerage's contract. Please remit payment
          through the channel your account manager has already shared with you.
        </p>
      </div>
    </div>
  );
}
