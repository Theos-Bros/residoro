import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  session: Session;
};

// tb-client-lifecycle-enrollment-001's "New Client" form: brokerage name,
// initial admin's email, and contract dates. Client-side date-order check is
// a UX nicety only -- POST /admin/clients re-validates everything server-side.
export function NewClientForm({ session }: Props) {
  const [brokerageName, setBrokerageName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [contractStartDate, setContractStartDate] = useState('');
  const [contractEndDate, setContractEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (contractEndDate && contractStartDate && contractEndDate <= contractStartDate) {
      setError('Contract end date must be after the contract start date.');
      return;
    }

    setSubmitting(true);
    try {
      await createClient(session.access_token, {
        brokerage_name: brokerageName,
        admin_email: adminEmail,
        contract_start_date: contractStartDate,
        contract_end_date: contractEndDate,
      });
      navigate('/admin', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">New client</h1>
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="brokerage_name">Brokerage name</Label>
              <Input
                id="brokerage_name"
                value={brokerageName}
                onChange={(e) => setBrokerageName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin_email">Initial admin email</Label>
              <Input
                id="admin_email"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contract_start_date">Contract start date</Label>
              <Input
                id="contract_start_date"
                type="date"
                value={contractStartDate}
                onChange={(e) => setContractStartDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contract_end_date">Contract end date</Label>
              <Input
                id="contract_end_date"
                type="date"
                value={contractEndDate}
                onChange={(e) => setContractEndDate(e.target.value)}
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create client'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
