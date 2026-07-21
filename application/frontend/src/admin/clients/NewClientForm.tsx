import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

const inputClass = 'w-full rounded-md border border-input px-3 py-2 text-sm';

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
    <div className="max-w-md">
      <h1 className="text-2xl font-semibold">New client</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="brokerage_name" className="text-sm font-medium">
            Brokerage name
          </label>
          <input
            id="brokerage_name"
            value={brokerageName}
            onChange={(e) => setBrokerageName(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="admin_email" className="text-sm font-medium">
            Initial admin email
          </label>
          <input
            id="admin_email"
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="contract_start_date" className="text-sm font-medium">
            Contract start date
          </label>
          <input
            id="contract_start_date"
            type="date"
            value={contractStartDate}
            onChange={(e) => setContractStartDate(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="contract_end_date" className="text-sm font-medium">
            Contract end date
          </label>
          <input
            id="contract_end_date"
            type="date"
            value={contractEndDate}
            onChange={(e) => setContractEndDate(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create client'}
        </Button>
      </form>
    </div>
  );
}
