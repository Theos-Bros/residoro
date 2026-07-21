import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchClients, type Client } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

// First real content in the admin dashboard shell (tb-client-lifecycle-
// enrollment-001) -- table of every enrolled workspace, refetched on mount
// so a freshly-created client (and its invite status) shows up after
// NewClientForm navigates back here.
export function ClientList({ session }: Props) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchClients(session.access_token)
      .then(({ clients }) => {
        if (!cancelled) setClients(clients);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [session.access_token]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <Button asChild>
          <Link to="/admin/clients/new">New client</Link>
        </Button>
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {!error && clients === null && (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      )}

      {clients?.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">No clients enrolled yet.</p>
      )}

      {clients && clients.length > 0 && (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4 font-medium">Brokerage</th>
              <th className="py-2 pr-4 font-medium">Contract start</th>
              <th className="py-2 pr-4 font-medium">Contract end</th>
              <th className="py-2 pr-4 font-medium">Invite status</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.workspace_id} className="border-b">
                <td className="py-2 pr-4">{client.brokerage_name}</td>
                <td className="py-2 pr-4">{client.contract_start_date}</td>
                <td className="py-2 pr-4">{client.contract_end_date}</td>
                <td className="py-2 pr-4 capitalize">{client.invite_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
