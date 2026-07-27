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
import { fetchContacts, type Contact } from '@/lib/contactsApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ListingHistoryPanel } from '@/components/ListingHistoryPanel';
import { ShareDetailsModal } from '@/components/ShareDetailsModal';
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
type OpenShare = { listingId: string; propertyTitle: string } | null;

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
  const [openShare, setOpenShare] = useState<OpenShare>(null);
  const [renewDates, setRenewDates] = useState<Record<string, string>>({});
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [buyerSelections, setBuyerSelections] = useState<Record<string, string>>({});

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

  // tb-crm-buyer-ui-001: lazy-fetch contacts only once a listing actually
  // needs a buyer picker -- mirrors NewPropertyListingForm's own
  // fetch-on-condition pattern rather than loading contacts unconditionally.
  useEffect(() => {
    if (contacts !== null) return;
    if (!listings?.some((l) => l.status === 'under_offer')) return;
    let cancelled = false;

    fetchContacts(session.access_token)
      .then(({ contacts }) => {
        if (!cancelled) setContacts(contacts);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [listings, contacts, session.access_token]);

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

  async function handleMarkSold(listingId: string) {
    const buyerContactId = buyerSelections[listingId];
    if (!buyerContactId) {
      setError('Select a buyer before marking this listing sold.');
      return;
    }
    setError(null);
    setWarning(null);
    try {
      const result = await updateListingStatus(session.access_token, listingId, 'sold', {
        buyer_contact_id: buyerContactId,
      });
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
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Listings</h1>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {warning && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {warning}
        </p>
      )}
      {!error && listings === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {listings?.length === 0 && (
        <p className="text-sm text-muted-foreground">No listings yet — create one from the Properties page.</p>
      )}

      {listings && listings.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Exclusivity</TableHead>
                <TableHead>Authority to Sell/Lease</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listings.map((listing) => (
                <TableRow
                  key={listing.id}
                  className={cn(openHistory?.propertyId === listing.property_id && 'bg-amber-100')}
                >
                  <TableCell className="font-medium">{listing.property_title}</TableCell>
                  <TableCell className="capitalize">{listing.listing_type}</TableCell>
                  <TableCell>
                    {listing.price_currency} {listing.price.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={listing.exclusivity === 'exclusive' ? 'default' : 'secondary'}>
                      {listing.exclusivity === 'exclusive' ? 'Exclusive' : 'Open'}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {new Date(listing.authority_starts_at).toLocaleDateString()}
                    {' – '}
                    {listing.authority_expires_at
                      ? new Date(listing.authority_expires_at).toLocaleDateString()
                      : 'open-ended'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={listing.status === 'expired' ? 'destructive' : 'secondary'}>
                      {STATUS_LABEL[listing.status]}
                    </Badge>
                    {listing.status === 'expired' && (
                      <p className="mt-1 text-xs text-destructive">{authorityWarningLabel(listing.listing_type)}</p>
                    )}
                    {listing.status === 'sold' && listing.buyer_name && (
                      <p className="mt-1 text-xs text-muted-foreground">Buyer: {listing.buyer_name}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      {listing.status === 'expired' ? (
                        <>
                          <input
                            type="date"
                            value={renewDates[listing.id] ?? ''}
                            onChange={(e) => setRenewDates((prev) => ({ ...prev, [listing.id]: e.target.value }))}
                            className="h-8 rounded-md border border-input px-2 text-sm"
                          />
                          <Button size="sm" variant="outline" onClick={() => handleRenew(listing.id)}>
                            Renew
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleStatus(listing.id, 'withdrawn')}>
                            Mark Withdrawn
                          </Button>
                        </>
                      ) : (
                        LISTING_STATUS_TRANSITIONS[listing.status].map((nextStatus) =>
                          nextStatus === 'sold' ? (
                            <div key="sold" className="flex items-center gap-2">
                              <select
                                value={buyerSelections[listing.id] ?? ''}
                                onChange={(e) =>
                                  setBuyerSelections((prev) => ({ ...prev, [listing.id]: e.target.value }))
                                }
                                className="h-8 rounded-md border border-input px-2 text-sm"
                              >
                                <option value="">Select buyer…</option>
                                {contacts?.map((contact) => (
                                  <option key={contact.id} value={contact.id}>
                                    {contact.name}
                                  </option>
                                ))}
                              </select>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!buyerSelections[listing.id]}
                                onClick={() => handleMarkSold(listing.id)}
                              >
                                Mark Sold
                              </Button>
                            </div>
                          ) : (
                            <Button
                              key={nextStatus}
                              size="sm"
                              variant="outline"
                              onClick={() => handleStatus(listing.id, nextStatus)}
                            >
                              Mark {STATUS_LABEL[nextStatus]}
                            </Button>
                          ),
                        )
                      )}
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/listings/${listing.id}/share`}>Share as docket</Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setOpenShare({ listingId: listing.id, propertyTitle: listing.property_title })}
                      >
                        Share Details
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
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {openHistory && (
        <ListingHistoryPanel
          session={session}
          propertyId={openHistory.propertyId}
          propertyTitle={openHistory.propertyTitle}
          onClose={() => setOpenHistory(null)}
        />
      )}
      {openShare && (
        <ShareDetailsModal
          session={session}
          listingId={openShare.listingId}
          propertyTitle={openShare.propertyTitle}
          onClose={() => setOpenShare(null)}
        />
      )}
    </div>
  );
}
