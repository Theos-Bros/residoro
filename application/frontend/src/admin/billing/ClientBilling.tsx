import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  createInstallment,
  deleteInstallment,
  fetchBilling,
  setContractBilling,
  updateInstallment,
  type BillingInstallment,
  type ContractBilling,
} from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Props = {
  session: Session;
};

// tb-billing-installments-001: operator-only. Sets a tenant's contract value
// and manages its installments (create/edit/delete/mark paid). No brokerage
// UI reads any of this yet -- see the tracer bullet's own scope. tenantId
// comes from the route, same pattern as ClientMigration/TrainingScheduleForm.
export function ClientBilling({ session }: Props) {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [contractBilling, setContractBillingState] = useState<ContractBilling | null>(null);
  const [installments, setInstallments] = useState<BillingInstallment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [contractValue, setContractValueInput] = useState('');
  const [currency, setCurrency] = useState('PHP');
  const [savingContract, setSavingContract] = useState(false);

  const [newAmount, setNewAmount] = useState('');
  const [newCurrency, setNewCurrency] = useState('PHP');
  const [newDueDate, setNewDueDate] = useState('');
  const [addingInstallment, setAddingInstallment] = useState(false);

  function reload() {
    fetchBilling(session.access_token, tenantId!)
      .then(({ contract_billing, installments }) => {
        setContractBillingState(contract_billing);
        setInstallments(installments);
        if (contract_billing) {
          setContractValueInput(String(contract_billing.contract_value));
          setCurrency(contract_billing.currency);
          setNewCurrency(contract_billing.currency);
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function handleSaveContract(e: FormEvent) {
    e.preventDefault();
    const value = Number(contractValue);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Contract value must be a positive number.');
      return;
    }
    setError(null);
    setSavingContract(true);
    try {
      await setContractBilling(session.access_token, tenantId!, value, currency);
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingContract(false);
    }
  }

  async function handleAddInstallment(e: FormEvent) {
    e.preventDefault();
    const amount = Number(newAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !newDueDate) {
      setError('Installment amount must be positive and a due date is required.');
      return;
    }
    setError(null);
    setAddingInstallment(true);
    try {
      await createInstallment(session.access_token, tenantId!, amount, newCurrency, newDueDate);
      setNewAmount('');
      setNewDueDate('');
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAddingInstallment(false);
    }
  }

  async function handleTogglePaid(installment: BillingInstallment) {
    setError(null);
    try {
      await updateInstallment(session.access_token, tenantId!, installment.id, {
        status: installment.status === 'paid' ? 'unpaid' : 'paid',
      });
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(installmentId: string) {
    setError(null);
    try {
      await deleteInstallment(session.access_token, tenantId!, installmentId);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const sameCurrencyInstallments = installments.filter((i) => i.currency === contractBilling?.currency);
  const installmentsSum = sameCurrencyInstallments.reduce((sum, i) => sum + i.amount, 0);
  const hasMixedCurrencies = installments.length > sameCurrencyInstallments.length;
  const showSumWarning =
    contractBilling !== null && installments.length > 0 && !hasMixedCurrencies && installmentsSum !== contractBilling.contract_value;

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-sm font-medium">Contract value</h2>
          <form onSubmit={handleSaveContract} className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="currency">
                Currency <span className="text-primary">*</span>
              </Label>
              <Input
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-20"
                required
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="contract_value">
                Contract value <span className="text-primary">*</span>
              </Label>
              <MoneyInput id="contract_value" value={contractValue} onChange={setContractValueInput} required />
            </div>
            <Button type="submit" disabled={savingContract}>
              {savingContract ? 'Saving…' : 'Save'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {showSumWarning && (
        <p role="alert" className="text-sm text-amber-600">
          Installments sum to {contractBilling!.currency} {installmentsSum.toLocaleString()}, which doesn't match the contract
          value of {contractBilling!.currency} {contractBilling!.contract_value.toLocaleString()}. Contracts can legitimately
          change mid-term — this is a heads-up, not a block.
        </p>
      )}
      {hasMixedCurrencies && (
        <p className="text-sm text-muted-foreground">
          Some installments use a different currency than the contract — sum check skipped.
        </p>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-sm font-medium">Installments</h2>

          {installments.length === 0 && <p className="text-sm text-muted-foreground">No installments yet.</p>}

          {installments.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Due date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Paid date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
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
                      <TableCell className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleTogglePaid(installment)}>
                          {installment.status === 'paid' ? 'Mark unpaid' : 'Mark paid'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleDelete(installment.id)}>
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <form onSubmit={handleAddInstallment} className="flex items-end gap-3 border-t pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="new_currency">
                Currency <span className="text-primary">*</span>
              </Label>
              <Input
                id="new_currency"
                value={newCurrency}
                onChange={(e) => setNewCurrency(e.target.value)}
                className="w-20"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new_amount">
                Amount <span className="text-primary">*</span>
              </Label>
              <MoneyInput id="new_amount" value={newAmount} onChange={setNewAmount} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new_due_date">
                Due date <span className="text-primary">*</span>
              </Label>
              <Input
                id="new_due_date"
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={addingInstallment}>
              {addingInstallment ? 'Adding…' : 'Add installment'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
