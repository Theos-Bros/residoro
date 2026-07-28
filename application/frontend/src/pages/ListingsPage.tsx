import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchListings, authorityWarningLabel, STATUS_LABEL, type Listing } from '@/lib/listingsApi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ListingHistoryPanel } from '@/components/ListingHistoryPanel';
import { ShareDetailsModal } from '@/components/ShareDetailsModal';
import { ListingDetailModal } from '@/components/ListingDetailModal';
import { cn } from '@/lib/utils';

type Props = {
  session: Session;
};

type OpenHistory = { propertyId: string; propertyTitle: string } | null;
type OpenShare = { listingId: string; propertyTitle: string } | null;

// UX follow-up: "History" opens a floating panel (bottom-right) instead of
// navigating to a separate route, same as PropertiesListPage. A row whose
// property has that panel open gets a light-gold highlight so it's obvious
// which row the floating panel belongs to. Authority (ATS/ATL) expiry is now
// automatic (backend auto-expires on read, see listingsApi's comment).
//
// tb-listings-detail-edit-modal-001: rows are now clickable and open
// ListingDetailModal, which owns the status-transition controls (Mark
// <status>, Mark Sold + buyer picker, Renew) that used to live in this
// page's own Actions cell -- see that component for the relocated logic.
// This page now only tracks which listing's detail modal is open, looked up
// fresh from `listings` on every render so a status change or field edit
// made inside the modal shows up here (and in the modal) without closing it.
export function ListingsPage({ session }: Props) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<OpenHistory>(null);
  const [openShare, setOpenShare] = useState<OpenShare>(null);
  // tb-buyer-leads-schema-001: LeadDetailPanel's "Mark Sold on Listings Page"
  // convenience action navigates here with this state, opening that
  // listing's detail modal with the buyer already pre-selected -- purely a
  // UI convenience, never a second write path; the actual sold transition
  // still goes through ListingDetailModal's own handleMarkSold -> PATCH
  // /listings/:id, entirely unmodified.
  const location = useLocation();
  const prefill = location.state as { prefillListingId?: string; prefillBuyerContactId?: string } | null;
  const [openDetailId, setOpenDetailId] = useState<string | null>(prefill?.prefillListingId ?? null);
  // Bumped on every row click (even re-clicking the currently-open listing)
  // and used as ListingDetailModal's `key` below, forcing a fresh mount --
  // and so a fresh, expanded FloatingPanel -- every time a row is clicked.
  // Without this, clicking a different row while the modal is minimized just
  // swapped its content underneath without popping it back open, since
  // FloatingPanel's collapsed state lives inside the same component instance
  // across a plain prop change.
  const [openDetailToken, setOpenDetailToken] = useState(0);
  const openDetailListing = listings?.find((l) => l.id === openDetailId) ?? null;

  function openDetail(listingId: string) {
    setOpenDetailId(listingId);
    setOpenDetailToken((t) => t + 1);
  }

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Listings</h1>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
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
                  onClick={() => openDetail(listing.id)}
                  className={cn(
                    'cursor-pointer hover:bg-muted/50',
                    openHistory?.propertyId === listing.property_id && 'bg-amber-100',
                  )}
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
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap justify-end gap-2">
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
      {openDetailListing && (
        <ListingDetailModal
          key={openDetailToken}
          session={session}
          listing={openDetailListing}
          onClose={() => setOpenDetailId(null)}
          onUpdated={reload}
          initialBuyerContactId={
            openDetailListing.id === prefill?.prefillListingId ? prefill?.prefillBuyerContactId : undefined
          }
        />
      )}
    </div>
  );
}
