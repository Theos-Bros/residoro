import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  fetchListings,
  updateListingStatus,
  authorityWarningLabel,
  LISTING_STATUS_TRANSITIONS,
  type Listing,
  type ListingStatus,
} from '@/lib/listingsApi';
import { Button } from '@/components/ui/button';
import { ListingHistoryPanel } from '@/components/ListingHistoryPanel';
import { cn } from '@/lib/utils';

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
// navigating to a separate route, same as PropertiesListPage. A row whose
// property has that panel open gets a light-gold highlight so it's obvious
// which row the floating panel belongs to. Authority (ATS/ATL) expiry is now
// automatic (backend auto-expires on read, see listingsApi's comment) --
// 'expired' rows get a warning badge and a renewal control (new date +
// Renew) instead of a generic "Mark Expired" button, since there never was
// one to begin with.
export function ListingsPage({ session }: Props) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<OpenHistory>(null);
  const [renewDates, setRenewDates] = useState<Record<string, string>>({});

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

  async function handleRenew(listingId: string) {
    const newExpiresAt = renewDates[listingId];
    if (!newExpiresAt) {
      setError('Pick a new Authority to Sell/Lease end date to renew.');
      return;
    }
    setError(null);
    setWarning(null);
    try {
      const result = await updateListingStatus(session.access_token, listingId, 'active', {
        authority_expires_at: new Date(newExpiresAt).toISOString(),
      });
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
              <tr
                key={listing.id}
                className={cn(openHistory?.propertyId === listing.property_id && 'bg-amber-100')}
              >
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
                <td>
                  {STATUS_LABEL[listing.status]}
                  {listing.status === 'expired' && (
                    <span className="ml-2 text-destructive">{authorityWarningLabel(listing.listing_type)}</span>
                  )}
                </td>
                <td>
                  {listing.status === 'expired' ? (
                    <>
                      <input
                        type="date"
                        value={renewDates[listing.id] ?? ''}
                        onChange={(e) => setRenewDates((prev) => ({ ...prev, [listing.id]: e.target.value }))}
                        className="rounded-md border border-input px-2 py-1 text-sm"
                      />
                      <Button size="sm" variant="outline" onClick={() => handleRenew(listing.id)}>
                        Renew
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleStatus(listing.id, 'withdrawn')}>
                        Mark Withdrawn
                      </Button>
                    </>
                  ) : (
                    LISTING_STATUS_TRANSITIONS[listing.status].map((nextStatus) => (
                      <Button
                        key={nextStatus}
                        size="sm"
                        variant="outline"
                        onClick={() => handleStatus(listing.id, nextStatus)}
                      >
                        Mark {STATUS_LABEL[nextStatus]}
                      </Button>
                    ))
                  )}
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
