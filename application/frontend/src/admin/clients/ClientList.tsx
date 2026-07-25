import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { extendContract, fetchClients, setExclusivityHardBlock, type Client } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
  const [policyError, setPolicyError] = useState<string | null>(null);

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

  async function handleToggleHardBlock(workspaceId: string, next: boolean) {
    setPolicyError(null);
    try {
      await setExclusivityHardBlock(session.access_token, workspaceId, next);
      reload();
    } catch (err) {
      setPolicyError((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <Button asChild size="sm">
          <Link to="/admin/clients/new">New client</Link>
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!error && clients === null && <p className="text-sm text-muted-foreground">Loading…</p>}

      {clients?.length === 0 && <p className="text-sm text-muted-foreground">No clients enrolled yet.</p>}

      {clients && clients.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brokerage</TableHead>
                <TableHead>Contract start</TableHead>
                <TableHead>Contract end</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Invite status</TableHead>
                <TableHead>Hard-block exclusivity</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.workspace_id}>
                  <TableCell className="font-medium">{client.brokerage_name}</TableCell>
                  <TableCell>{client.contract_start_date}</TableCell>
                  <TableCell>{client.contract_end_date}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        client.access_state === 'active'
                          ? 'secondary'
                          : client.access_state === 'read_only'
                            ? 'outline'
                            : 'destructive'
                      }
                    >
                      {ACCESS_STATE_LABEL[client.access_state]}
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize">{client.invite_status}</TableCell>
                  <TableCell>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={client.exclusivity_hard_block}
                        onChange={(e) => handleToggleHardBlock(client.workspace_id, e.target.checked)}
                        className="h-4 w-4 rounded border-input"
                      />
                      {client.exclusivity_hard_block ? 'Blocking' : 'Soft warning'}
                    </label>
                  </TableCell>
                  <TableCell className="flex flex-wrap justify-end gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/admin/clients/${client.workspace_id}/migrate`}>Migrate</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/admin/clients/${client.workspace_id}/training`}>Training</Link>
                    </Button>
                    {renewingId === client.workspace_id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="date"
                          value={renewDate}
                          onChange={(e) => setRenewDate(e.target.value)}
                          className="h-9 w-auto"
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {renewError && (
        <p role="alert" className="text-sm text-destructive">
          {renewError}
        </p>
      )}
      {policyError && (
        <p role="alert" className="text-sm text-destructive">
          {policyError}
        </p>
      )}
    </div>
  );
}
