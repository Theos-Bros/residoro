import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchListings, updateListingStatus, type Listing } from '@/lib/listingsApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

const STATUS_LABEL: Record<Listing['status'], string> = {
  draft: 'Draft',
  active: 'Active',
  withdrawn: 'Withdrawn',
};

// tb-listings-create-001: where a listing's status moves from draft to
// active, or to withdrawn -- the only two transitions in this tracer
// bullet's scope (no under_offer/sold/expired yet, see cap-listings-001
// Milestone 2/3).
export function ListingsPage({ session }: Props) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  function reload() {
    fetchListings(session.access_token)
      .then(({ listings }) => setListings(listings))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    let cancelled = false;

    fetchListings(session.access_token)
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

  async function handleStatus(listingId: string, status: 'active' | 'withdrawn') {
    setWarning(null);
    try {
      const result = await updateListingStatus(session.access_token, listingId, status);
      if (result.warning) setWarning(result.warning);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h1>Listings</h1>

      {error && <p role="alert">{error}</p>}
      {warning && <p role="alert">{warning}</p>}
      {!error && listings === null && <p>Loading…</p>}
      {listings?.length === 0 && <p>No listings yet — create one from the Properties page.</p>}

      {listings && listings.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Type</th>
              <th>Price</th>
              <th>Exclusivity</th>
              <th>Authority to Sell/Lease</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {listings.map((listing) => (
              <tr key={listing.id}>
                <td>{listing.property_title}</td>
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
                <td>
                  {listing.status !== 'active' && (
                    <Button size="sm" variant="outline" onClick={() => handleStatus(listing.id, 'active')}>
                      Mark active
                    </Button>
                  )}
                  {listing.status !== 'withdrawn' && (
                    <Button size="sm" variant="outline" onClick={() => handleStatus(listing.id, 'withdrawn')}>
                      Withdraw
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
