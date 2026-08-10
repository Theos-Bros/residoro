import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  fetchListings,
  authorityWarningLabel,
  matchesKeyword,
  STATUS_LABEL,
  type Listing,
  type ListingStatus,
} from '@/lib/listingsApi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ListingHistoryPanel } from '@/components/ListingHistoryPanel';
import { ShareDetailsModal } from '@/components/ShareDetailsModal';
import { ShareDocketModal } from '@/components/ShareDocketModal';
import { DocketSharesPanel } from '@/components/DocketSharesPanel';
import { ListingDetailModal } from '@/components/ListingDetailModal';
import { ListingFilterTabs, type FilterTabOption } from '@/components/ListingFilterTabs';
import { TaskDetailPanel } from '@/components/TaskDetailPanel';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import { useHighlightFromSearch } from '@/hooks/useHighlightFromSearch';
import { cn } from '@/lib/utils';

type Props = {
  session: Session;
};

type OpenHistory = { propertyId: string; propertyTitle: string } | null;
type OpenShare = { listingId: string; propertyTitle: string } | null;
type OpenDocketShares = { listingId: string; propertyTitle: string } | null;

// tb-listings-filters-001: three independent, combinable (AND) client-side
// filters over the already-fetched `listings` array -- no new API surface,
// no persistence across reload/navigation (state resets on remount by
// design, per the tracer bullet's non-goals).
type StatusFilter = 'all' | ListingStatus;
type TypeFilter = 'all' | 'sale' | 'lease';
type ExpiryBucket = 'active' | 'expiring_soon' | 'expired';
type ExpiryFilter = 'all' | ExpiryBucket;

const STATUS_FILTER_OPTIONS: readonly FilterTabOption<StatusFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: STATUS_LABEL.draft },
  { value: 'active', label: STATUS_LABEL.active },
  { value: 'under_offer', label: STATUS_LABEL.under_offer },
  { value: 'sold', label: STATUS_LABEL.sold },
  { value: 'expired', label: STATUS_LABEL.expired },
  { value: 'withdrawn', label: STATUS_LABEL.withdrawn },
  { value: 'inactive', label: STATUS_LABEL.inactive },
];

const TYPE_FILTER_OPTIONS: readonly FilterTabOption<TypeFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'sale', label: 'Sale' },
  { value: 'lease', label: 'Lease' },
];

const EXPIRY_FILTER_OPTIONS: readonly FilterTabOption<ExpiryFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expiring_soon', label: 'Expiring Soon' },
  { value: 'expired', label: 'Expired' },
];

// Hardcoded per the tracer bullet's non-goals -- not configurable.
const EXPIRING_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Purely a read-only client-side derivation over authority_expires_at -- does
// not touch, and is independent of, the listing's `status` field or the
// backend's autoExpireLapsedListings sweep.
// tb-listings-property-specs-001: compact one-line summary of the listing's
// underlying property specs, omitting any field that's null.
function formatSpecsSummary(listing: Listing): string {
  const parts: string[] = [];
  if (listing.property_bedrooms !== null) parts.push(`${listing.property_bedrooms} BD`);
  if (listing.property_bathrooms !== null) parts.push(`${listing.property_bathrooms} BA`);
  if (listing.property_parking_slots !== null) parts.push(`${listing.property_parking_slots} parking`);
  if (listing.property_storeys !== null) {
    parts.push(`${listing.property_storeys} storey${listing.property_storeys === 1 ? '' : 's'}`);
  }
  if (listing.property_floor_area_sqm !== null) parts.push(`${listing.property_floor_area_sqm} sqm`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function expiryBucket(listing: Listing, now: number): ExpiryBucket {
  const expiresAt = listing.authority_expires_at ? new Date(listing.authority_expires_at).getTime() : null;
  if (expiresAt !== null && expiresAt < now) return 'expired';
  if (expiresAt !== null && expiresAt < now + EXPIRING_SOON_WINDOW_MS) return 'expiring_soon';
  return 'active';
}

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
  const [shareDocketListingId, setShareDocketListingId] = useState<string | null>(null);
  const [openDocketShares, setOpenDocketShares] = useState<OpenDocketShares>(null);
  // tb-buyer-leads-schema-001: LeadDetailPanel's "Mark Sold on Listings Page"
  // convenience action navigates here with this state, opening that
  // listing's detail modal with the buyer already pre-selected -- purely a
  // UI convenience, never a second write path; the actual sold transition
  // still goes through ListingDetailModal's own handleMarkSold -> PATCH
  // /listings/:id, entirely unmodified.
  const location = useLocation();
  // tb-tasks-linked-entity-display-001: `openId` is the same location.state
  // deep-link convention LeadsPage.tsx's openLeadId already established --
  // lets a task's linked-entity link (or any other future caller) land here
  // with a specific listing's detail modal already open.
  const prefill = location.state as
    | { prefillListingId?: string; prefillBuyerContactId?: string; openId?: string }
    | null;
  const [openDetailId, setOpenDetailId] = useState<string | null>(prefill?.prefillListingId ?? prefill?.openId ?? null);
  const { status: workspaceStatus } = useWorkspaceStatus(session);
  const isAdmin = workspaceStatus?.role === 'admin';
  // tb-tasks-linked-entity-display-001: mirrors LeadsPage.tsx's own
  // openPanel 'task' variant -- FloatingPanel is "one at a time", so opening
  // a task from ListingDetailModal's "Add Task" button swaps the listing
  // modal out for a standalone TaskDetailPanel, then swaps back in on close.
  const [openTaskId, setOpenTaskId] = useState<string | 'new' | null>(null);
  // Bumped on every row click (even re-clicking the currently-open listing)
  // and used as ListingDetailModal's `key` below, forcing a fresh mount --
  // and so a fresh, expanded FloatingPanel -- every time a row is clicked.
  // Without this, clicking a different row while the modal is minimized just
  // swapped its content underneath without popping it back open, since
  // FloatingPanel's collapsed state lives inside the same component instance
  // across a plain prop change.
  const [openDetailToken, setOpenDetailToken] = useState(0);
  const openDetailListing = listings?.find((l) => l.id === openDetailId) ?? null;
  const { highlightedId, clearHighlight } = useHighlightFromSearch(listings !== null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('all');
  // tb-listings-properties-keyword-search-001: a fourth, AND-combined
  // predicate alongside the three tab filters above -- plain title/address
  // substring match, component-local state (not persisted), same pattern.
  const [keyword, setKeyword] = useState('');

  const filteredListings = useMemo(() => {
    if (!listings) return null;
    const now = Date.now();
    return listings.filter((listing) => {
      if (statusFilter !== 'all' && listing.status !== statusFilter) return false;
      if (typeFilter !== 'all' && listing.listing_type !== typeFilter) return false;
      if (expiryFilter !== 'all' && expiryBucket(listing, now) !== expiryFilter) return false;
      if (!matchesKeyword(listing.property_title, listing.property_address, keyword)) return false;
      return true;
    });
  }, [listings, statusFilter, typeFilter, expiryFilter, keyword]);

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
        <div className="space-y-2 rounded-lg border p-3">
          <ListingFilterTabs label="Status" options={STATUS_FILTER_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
          <ListingFilterTabs label="Type" options={TYPE_FILTER_OPTIONS} value={typeFilter} onChange={setTypeFilter} />
          <ListingFilterTabs label="Expiry" options={EXPIRY_FILTER_OPTIONS} value={expiryFilter} onChange={setExpiryFilter} />
          <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Search
            </span>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Search by title or address…"
              aria-label="Search listings by title or address"
              className="h-8 w-full max-w-sm rounded-md border border-input bg-background px-2 text-sm shadow-sm"
            />
          </div>
        </div>
      )}

      {listings && listings.length > 0 && filteredListings?.length === 0 && (
        <p className="text-sm text-muted-foreground">No listings match the selected filters.</p>
      )}

      {filteredListings && filteredListings.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Specs</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Exclusivity</TableHead>
                <TableHead>Authority to Sell/Lease</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredListings.map((listing) => (
                <TableRow
                  key={listing.id}
                  data-row-id={listing.id}
                  onClick={() => {
                    clearHighlight();
                    openDetail(listing.id);
                  }}
                  className={cn(
                    'cursor-pointer hover:bg-muted/50',
                    (openHistory?.propertyId === listing.property_id || highlightedId === listing.id) &&
                      'bg-amber-100',
                  )}
                >
                  <TableCell className="font-medium">{listing.property_title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatSpecsSummary(listing)}</TableCell>
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShareDocketListingId(listing.id)}
                      >
                        Share as docket
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setOpenDocketShares({ listingId: listing.id, propertyTitle: listing.property_title })
                        }
                      >
                        Docket Shares
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
      {shareDocketListingId && (
        <ShareDocketModal
          session={session}
          listingId={shareDocketListingId}
          onClose={() => setShareDocketListingId(null)}
        />
      )}
      {openDocketShares && (
        <DocketSharesPanel
          session={session}
          listingId={openDocketShares.listingId}
          propertyTitle={openDocketShares.propertyTitle}
          onClose={() => setOpenDocketShares(null)}
        />
      )}
      {openDetailListing && !openTaskId && (
        <ListingDetailModal
          key={openDetailToken}
          session={session}
          listing={openDetailListing}
          onClose={() => setOpenDetailId(null)}
          onUpdated={reload}
          initialBuyerContactId={
            openDetailListing.id === prefill?.prefillListingId ? prefill?.prefillBuyerContactId : undefined
          }
          onOpenTask={setOpenTaskId}
        />
      )}
      {openTaskId && openDetailId && (
        <TaskDetailPanel
          session={session}
          taskId={openTaskId}
          isAdmin={isAdmin}
          prefillEntity={{ entityType: 'listing', entityId: openDetailId }}
          onClose={() => setOpenTaskId(null)}
          onSaved={() => {}}
        />
      )}
    </div>
  );
}
