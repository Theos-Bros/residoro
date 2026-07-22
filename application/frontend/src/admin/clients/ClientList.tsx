import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { extendContract, fetchClients, type Client } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

const ACCESS_STATE_LABEL: Record<Client['access_state'], string> = {
  active: 'Active',
  read_only: 'Read-only (grace period)',
  blocked: 'Blocked',
};

// First real content in the admin dashboard shell (tb-client-lifecycle-
// enrollment-001) -- table of every enrolled workspace, refetched on mount
// so a freshly-created client (and its invite status) shows up after
// NewClientForm navigates back here. access_state + inline renewal are
// tb-client-lifecycle-contract-expiry-001's addition -- the doc explicitly
// leaves a dedicated renewal screen undecided, so this is the smallest real
// path: extend the date inline, the next daily check clears the rest.
export function ClientList({ session }: Props) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [renewDate, setRenewDate] = useState('');
  const [renewError, setRenewError] = useState<string | null>(null);

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

  function reload() {
    fetchClients(session.access_token)
      .then(({ clients }) => setClients(clients))
      .catch((err: Error) => setError(err.message));
  }

  async function handleRenew(workspaceId: string) {
    setRenewError(null);
    try {
      await extendContract(session.access_token, workspaceId, renewDate);
      setRenewingId(null);
      setRenewDate('');
      reload();
    } catch (err) {
      setRenewError((err as Error).message);
    }
  }

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
              <th className="py-2 pr-4 font-medium">Access</th>
              <th className="py-2 pr-4 font-medium">Invite status</th>
              <th className="py-2 pr-4 font-medium" />
              <th className="py-2 pr-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.workspace_id} className="border-b">
                <td className="py-2 pr-4">{client.brokerage_name}</td>
                <td className="py-2 pr-4">{client.contract_start_date}</td>
                <td className="py-2 pr-4">{client.contract_end_date}</td>
                <td className="py-2 pr-4">{ACCESS_STATE_LABEL[client.access_state]}</td>
                <td className="py-2 pr-4 capitalize">{client.invite_status}</td>
                <td className="py-2 pr-4">
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/admin/clients/${client.workspace_id}/migrate`}>Migrate</Link>
                  </Button>
                </td>
                <td className="py-2 pr-4">
                  {renewingId === client.workspace_id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={renewDate}
                        onChange={(e) => setRenewDate(e.target.value)}
                        className="rounded-md border border-input px-2 py-1 text-sm"
                      />
                      <Button size="sm" onClick={() => handleRenew(client.workspace_id)} disabled={!renewDate}>
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRenewingId(null);
                          setRenewError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRenewingId(client.workspace_id);
                        setRenewDate(client.contract_end_date);
                      }}
                    >
                      Extend
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {renewError && <p className="mt-2 text-sm text-destructive">{renewError}</p>}
    </div>
  );
}
