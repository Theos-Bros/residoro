import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchListingsPerformance, type ListingPerformance } from '@/lib/analyticsApi';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Props = {
  session: Session;
};

// tb-analytics-share-performance-001: cap-analytics-001's first surface.
// Sorted by share_count_30d desc (already sorted server-side) -- a single
// current snapshot, no history/trend view (see the tracer bullet's What
// Happens Next).
export function PerformancePage({ session }: Props) {
  const [listings, setListings] = useState<ListingPerformance[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchListingsPerformance(session.access_token)
      .then(({ listings }) => {
        if (!cancelled) setListings(listings);
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
      <h1 className="text-2xl font-semibold tracking-tight">Performance</h1>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && listings === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {listings?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No listings yet — share counts appear here once a listing's share text has been copied.
        </p>
      )}

      {listings && listings.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Listing</TableHead>
                <TableHead>Shares (last 30 days)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listings.map((listing) => (
                <TableRow key={listing.listing_id}>
                  <TableCell className="font-medium">{listing.title}</TableCell>
                  <TableCell>{listing.share_count_30d}</TableCell>
                  <TableCell>
                    {listing.hot && <Badge>🔥 Hot</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
