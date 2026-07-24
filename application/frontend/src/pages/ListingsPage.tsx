import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  fetchListings,
  updateListingStatus,
  LISTING_STATUS_TRANSITIONS,
  type Listing,
  type ListingStatus,
} from '@/lib/listingsApi';
import { Button } from '@/components/ui/button';
import { ListingHistoryPanel } from '@/components/ListingHistoryPanel';

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

type OpenHistory = { propertyId: string; propertyTitle: string } | null;

// tb-listings-lifecycle-001: status actions now come from
// LISTING_STATUS_TRANSITIONS instead of the two hardcoded active/withdrawn
// buttons tb-listings-create-001 shipped with -- only legally-reachable next
// states are offered, matching the backend's own transition enforcement.
//
// UX follow-up: "History" opens a floating panel (bottom-right) instead of
// navigating to a separate route, same as PropertiesListPage.
export function ListingsPage({ session }: Props) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<OpenHistory>(null);

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

  async function handleStatus(listingId: string, status: ListingStatus) {
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
                  {LISTING_STATUS_TRANSITIONS[listing.status].map((nextStatus) => (
                    <Button
                      key={nextStatus}
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatus(listing.id, nextStatus)}
                    >
                      Mark {STATUS_LABEL[nextStatus]}
                    </Button>
                  ))}
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/listings/${listing.id}/share`}>Share as docket</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setOpenHistory({ propertyId: listing.property_id, propertyTitle: listing.property_title })
                    }
                  >
                    History
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {openHistory && (
        <ListingHistoryPanel
          session={session}
          propertyId={openHistory.propertyId}
          propertyTitle={openHistory.propertyTitle}
          onClose={() => setOpenHistory(null)}
        />
      )}
    </div>
  );
}
