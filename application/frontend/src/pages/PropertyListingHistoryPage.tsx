import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchProperties, fetchPropertyListingHistory, type Listing, type ListingStatus } from '@/lib/listingsApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
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
export function PropertyListingHistoryPage({ session }: Props) {
  const { propertyId } = useParams<{ propertyId: string }>();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [propertyTitle, setPropertyTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;

    fetchPropertyListingHistory(session.access_token, propertyId)
      .then(({ listings }) => {
        if (!cancelled) setListings(listings);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    fetchProperties(session.access_token)
      .then(({ properties }) => {
        if (!cancelled) setPropertyTitle(properties.find((p) => p.id === propertyId)?.title ?? null);
      })
      .catch(() => {
        /* property title is a nice-to-have; the history table itself doesn't depend on it */
      });

    return () => {
      cancelled = true;
    };
  }, [session.access_token, propertyId]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1>Listing History{propertyTitle ? `: ${propertyTitle}` : ''}</h1>
        <Button asChild size="sm" variant="outline">
          <Link to="/properties">Back to Properties</Link>
        </Button>
      </div>

      {error && <p role="alert">{error}</p>}
      {!error && listings === null && <p>Loading…</p>}
      {listings?.length === 0 && <p>No listings on this property yet.</p>}

      {listings && listings.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Type</th>
              <th>Price</th>
              <th>Exclusivity</th>
              <th>Authority to Sell/Lease</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {listings.map((listing) => (
              <tr key={listing.id}>
                <td>{new Date(listing.created_at).toLocaleDateString()}</td>
                <td>{listing.listing_type}</td>
                <td>
                  {listing.price_currency} {listing.price.toLocaleString()}
                </td>
                <td>{listing.exclusivity === 'exclusive' ? 'Exclusive' : 'Open'}</td>
                <td>
                  {new Date(listing.authority_starts_at).toLocaleDateString()}
                  {' – '}
                  {listing.authority_expires_at
                    ? new Date(listing.authority_expires_at).toLocaleDateString()
                    : 'open-ended'}
                </td>
                <td>{STATUS_LABEL[listing.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
