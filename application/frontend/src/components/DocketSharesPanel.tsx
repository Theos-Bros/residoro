import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchSentDockets, revokeDocket, DOCKET_FIELD_LABELS, type SentDocket } from '@/lib/listingsApi';
import { FloatingPanel } from '@/components/FloatingPanel';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
  listingId: string;
  propertyTitle: string;
  onClose: () => void;
};

// tb-listings-docket-shares-panel-001: the sharer-side counterpart to
// SharedWithMePage.tsx -- lists a listing's own active outgoing dockets
// (tenant-wide, not just the current user's own shares) with a Revoke button
// wired to the already-working, sharer-only PATCH /listing-dockets/:id.
export function DocketSharesPanel({ session, listingId, propertyTitle, onClose }: Props) {
  const [dockets, setDockets] = useState<SentDocket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchSentDockets(session.access_token, listingId)
      .then(({ dockets }) => {
        if (!cancelled) setDockets(dockets);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [session.access_token, listingId]);

  async function handleRevoke(docketId: string) {
    setRevokingId(docketId);
    setError(null);
    try {
      await revokeDocket(session.access_token, docketId);
      setDockets((current) => current?.filter((docket) => docket.id !== docketId) ?? current);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <FloatingPanel title={`Docket shares · ${propertyTitle}`} onClose={onClose}>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && dockets === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {dockets?.length === 0 && (
        <p className="text-sm text-muted-foreground">This listing hasn't been shared as a docket with anyone.</p>
      )}

      {dockets && dockets.length > 0 && (
        <ul className="space-y-3">
          {dockets.map((docket) => (
            <li key={docket.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-medium">@{docket.shared_with_handle ?? 'unknown'}</span>
                  <span className="ml-2 text-muted-foreground">
                    since {new Date(docket.created_at).toLocaleDateString()}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={revokingId === docket.id}
                  onClick={() => handleRevoke(docket.id)}
                >
                  {revokingId === docket.id ? 'Revoking…' : 'Revoke'}
                </Button>
              </div>
              <div className="mt-1 text-muted-foreground">
                {docket.included_fields.map((field) => DOCKET_FIELD_LABELS[field] ?? field).join(', ')}
              </div>
            </li>
          ))}
        </ul>
      )}
    </FloatingPanel>
  );
}
