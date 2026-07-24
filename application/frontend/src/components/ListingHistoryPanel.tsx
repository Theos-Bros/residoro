import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchPropertyListingHistory, authorityWarningLabel, type Listing, type ListingStatus } from '@/lib/listingsApi';
import { FloatingPanel } from '@/components/FloatingPanel';

type Props = {
  session: Session;
  propertyId: string;
  propertyTitle: string;
  onClose: () => void;
};

const STATUS_LABEL: Record<ListingStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  under_offer: 'Under Offer',
  sold: 'Sold',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
};

// tb-listings-lifecycle-001: "full listing history in chronological order"
// cap-listings-001 Milestone 3 names -- every listing a property has ever
// had, open or closed, since listings are never deleted or overwritten.
//
// UX follow-up: renders inside a FloatingPanel instead of its own route --
// propertyTitle comes from the caller (already known from the row being
// clicked) rather than a second fetch to look it up.
export function ListingHistoryPanel({ session, propertyId, propertyTitle, onClose }: Props) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchPropertyListingHistory(session.access_token, propertyId)
      .then(({ listings }) => {
        if (!cancelled) setListings(listings);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [session.access_token, propertyId]);

  return (
    <FloatingPanel
      title={`Listing history: ${propertyTitle}`}
      documentTitle={`${propertyTitle} · Residoro`}
      onClose={onClose}
    >
      {error && <p role="alert">{error}</p>}
      {!error && listings === null && <p>Loading…</p>}
      {listings?.length === 0 && <p>No listings on this property yet.</p>}

      {listings && listings.length > 0 && (
        <ul className="space-y-3">
          {listings.map((listing) => (
            <li key={listing.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {STATUS_LABEL[listing.status]}
                  {listing.status === 'expired' && (
                    <span className="ml-2 text-destructive">{authorityWarningLabel(listing.listing_type)}</span>
                  )}
                </span>
                <span className="text-muted-foreground">{new Date(listing.created_at).toLocaleDateString()}</span>
              </div>
              <div className="mt-1 text-muted-foreground">
                {listing.listing_type} · {listing.price_currency} {listing.price.toLocaleString()} ·{' '}
                {listing.exclusivity === 'exclusive' ? 'Exclusive' : 'Open'}
              </div>
              <div className="text-muted-foreground">
                {new Date(listing.authority_starts_at).toLocaleDateString()}
                {' – '}
                {listing.authority_expires_at
                  ? new Date(listing.authority_expires_at).toLocaleDateString()
                  : 'open-ended'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </FloatingPanel>
  );
}
