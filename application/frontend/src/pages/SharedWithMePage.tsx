import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  fetchReceivedDockets,
  DOCKET_FIELD_LABELS,
  formatDocketFieldValue,
  type ReceivedDocket,
} from '@/lib/listingsApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

type Props = {
  session: Session;
};

// tb-listings-co-broker-share-001: the recipient's read-only view of every
// active docket shared with them, across any tenant -- reflects the live
// state of the source listing on every load (live projection, not a
// snapshot), and never shows anything beyond each docket's own
// included_fields.
export function SharedWithMePage({ session }: Props) {
  const [dockets, setDockets] = useState<ReceivedDocket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchReceivedDockets(session.access_token)
      .then(({ dockets }) => {
        if (!cancelled) setDockets(dockets);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [session.access_token]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Shared with me</h1>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && dockets === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {dockets?.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing has been shared with you yet.</p>
      )}

      {dockets && dockets.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {dockets.map((docket) => (
            <Card key={docket.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  Shared by @{docket.shared_by_handle ?? 'unknown'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {Object.entries(docket.fields).map(([field, value]) => (
                      <TableRow key={field}>
                        <TableCell className="p-2 text-left font-medium text-muted-foreground">
                          {DOCKET_FIELD_LABELS[field] ?? field}
                        </TableCell>
                        <TableCell className="p-2">{formatDocketFieldValue(field, value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
