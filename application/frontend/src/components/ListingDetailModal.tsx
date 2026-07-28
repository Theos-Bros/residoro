import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  updateListingStatus,
  authorityWarningLabel,
  LISTING_STATUS_TRANSITIONS,
  STATUS_LABEL,
  type Listing,
  type ListingStatus,
} from '@/lib/listingsApi';
import { fetchContacts, type Contact } from '@/lib/contactsApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FloatingPanel } from '@/components/FloatingPanel';
import { CreateListingPanel } from '@/components/CreateListingPanel';

type Props = {
  session: Session;
  listing: Listing;
  onClose: () => void;
  onUpdated: () => void;
  // tb-buyer-leads-schema-001's "Mark Sold on Listings Page" convenience
  // action pre-selects a buyer -- see ListingsPage's prefill handling.
  initialBuyerContactId?: string;
};

// tb-listings-detail-edit-modal-001: opened by clicking a row on
// ListingsPage.tsx. Shows every field on the listing read-only by default;
// "Edit" switches the same FloatingPanel into CreateListingPanel's form
// (embedded, no nested wrapper) for editing price/listing_type/exclusivity --
// none of which was editable post-creation before this tracer bullet. The
// status-transition controls (Mark <status>, Mark Sold + buyer picker, Renew
// for expired listings) are relocated here verbatim from ListingsPage.tsx's
// former row-actions cell; their behavior is unchanged, only their location
// moved. `listing` is looked up fresh from the parent's own `listings` array
// on every render (not a frozen snapshot), so a status change or field edit
// is reflected here immediately after `onUpdated` triggers the parent reload.
export function ListingDetailModal({ session, listing, onClose, onUpdated, initialBuyerContactId }: Props) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [buyerContactId, setBuyerContactId] = useState(initialBuyerContactId ?? '');
  const [renewDate, setRenewDate] = useState('');

  useEffect(() => {
    if (listing.status !== 'under_offer' || contacts !== null) return;
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
  }, [listing.status, contacts, session.access_token]);

  async function handleStatus(status: ListingStatus) {
    setError(null);
    setWarning(null);
    try {
      const result = await updateListingStatus(session.access_token, listing.id, status);
      if (result.warning) setWarning(result.warning);
      onUpdated();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleMarkSold() {
    if (!buyerContactId) {
      setError('Select a buyer before marking this listing sold.');
      return;
    }
    setError(null);
    setWarning(null);
    try {
      const result = await updateListingStatus(session.access_token, listing.id, 'sold', {
        buyer_contact_id: buyerContactId,
      });
      if (result.warning) setWarning(result.warning);
      onUpdated();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleRenew() {
    if (!renewDate) {
      setError('Pick a new Authority to Sell/Lease end date to renew.');
      return;
    }
    setError(null);
    setWarning(null);
    try {
      const result = await updateListingStatus(session.access_token, listing.id, 'active', {
        authority_expires_at: new Date(renewDate).toISOString(),
      });
      if (result.warning) setWarning(result.warning);
      onUpdated();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <FloatingPanel
      title={mode === 'edit' ? 'Edit listing' : 'Listing details'}
      documentTitle={`${listing.property_title} · Residoro`}
      onClose={onClose}
    >
      {mode === 'edit' ? (
        <CreateListingPanel
          session={session}
          propertyId={listing.property_id}
          propertyTitle={listing.property_title}
          editingListing={listing}
          embedded
          onClose={onClose}
          onCancel={() => setMode('view')}
          onSaved={() => {
            setMode('view');
            onUpdated();
          }}
        />
      ) : (
        <div className="space-y-4">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Property</dt>
              <dd className="font-medium">{listing.property_title}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Type</dt>
              <dd className="capitalize">{listing.listing_type}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Price</dt>
              <dd>
                {listing.price_currency} {listing.price.toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Exclusivity</dt>
              <dd>
                <Badge variant={listing.exclusivity === 'exclusive' ? 'default' : 'secondary'}>
                  {listing.exclusivity === 'exclusive' ? 'Exclusive' : 'Open'}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Authority to Sell/Lease</dt>
              <dd className="whitespace-nowrap text-right">
                {new Date(listing.authority_starts_at).toLocaleDateString()}
                {' – '}
                {listing.authority_expires_at
                  ? new Date(listing.authority_expires_at).toLocaleDateString()
                  : 'open-ended'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge variant={listing.status === 'expired' ? 'destructive' : 'secondary'}>
                  {STATUS_LABEL[listing.status]}
                </Badge>
              </dd>
            </div>
            {listing.status === 'expired' && (
              <p className="text-xs text-destructive">{authorityWarningLabel(listing.listing_type)}</p>
            )}
            {listing.status === 'sold' && listing.buyer_name && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Buyer</dt>
                <dd>{listing.buyer_name}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Created</dt>
              <dd>{new Date(listing.created_at).toLocaleDateString()}</dd>
            </div>
          </dl>

          <Button size="sm" onClick={() => setMode('edit')}>
            Edit
          </Button>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {warning && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {warning}
            </p>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            {listing.status === 'expired' ? (
              <>
                <input
                  type="date"
                  value={renewDate}
                  onChange={(e) => setRenewDate(e.target.value)}
                  className="h-8 rounded-md border border-input px-2 text-sm"
                />
                <Button size="sm" variant="outline" onClick={handleRenew}>
                  Renew
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleStatus('withdrawn')}>
                  Mark Withdrawn
                </Button>
              </>
            ) : (
              LISTING_STATUS_TRANSITIONS[listing.status].map((nextStatus) =>
                nextStatus === 'sold' ? (
                  <div key="sold" className="flex items-center gap-2">
                    <select
                      value={buyerContactId}
                      onChange={(e) => setBuyerContactId(e.target.value)}
                      className="h-8 rounded-md border border-input px-2 text-sm"
                    >
                      <option value="">Select buyer…</option>
                      {contacts?.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.name}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline" disabled={!buyerContactId} onClick={handleMarkSold}>
                      Mark Sold
                    </Button>
                  </div>
                ) : (
                  <Button key={nextStatus} size="sm" variant="outline" onClick={() => handleStatus(nextStatus)}>
                    Mark {STATUS_LABEL[nextStatus]}
                  </Button>
                ),
              )
            )}
          </div>
        </div>
      )}
    </FloatingPanel>
  );
}
