import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  updateListingStatus,
  authorityWarningLabel,
  LISTING_STATUS_TRANSITIONS,
  LISTING_STATUS_VARIANT,
  STATUS_LABEL,
  type Listing,
  type ListingStatus,
} from '@/lib/listingsApi';
import { fetchContacts, type Contact } from '@/lib/contactsApi';
import { fetchListingViewings, type Viewing } from '@/lib/viewingsApi';
import { fetchListingOffers, type Offer } from '@/lib/offersApi';
import { fetchListingContract, type Contract } from '@/lib/contractsApi';
import { fetchListingClosing, type Closing } from '@/lib/closingsApi';
import { fetchClosingCommissionEarnings, type CommissionEarnings } from '@/lib/commissionApi';
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
  // tb-transactions-viewings-001: read-only viewing history for this listing --
  // scheduling/outcome editing only happens from the Lead side (LeadDetailPanel).
  const [hazardCopied, setHazardCopied] = useState(false);
  const [viewings, setViewings] = useState<Viewing[]>([]);
  // tb-transactions-offers-001: read-only offer/negotiation history for this
  // listing -- recording/resolving offers only happens from the Lead side
  // (LeadDetailPanel), same split as viewings above.
  const [offers, setOffers] = useState<Offer[]>([]);
  // tb-transactions-contract-001: read-only contract for this listing --
  // creating/editing/advancing only happens from the Lead side (LeadDetailPanel).
  const [contract, setContract] = useState<Contract | null>(null);
  // tb-transactions-closing-001: read-only closing for this listing --
  // opening/editing/completing only happens from the Lead side.
  const [closing, setClosing] = useState<Closing | null>(null);
  // tb-commission-structure-001: read-only earnings for this listing's
  // closing, once one exists -- recording only happens from the Lead side.
  const [commissionEarnings, setCommissionEarnings] = useState<CommissionEarnings | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchListingViewings(session.access_token, listing.id)
      .then(({ viewings }) => {
        if (!cancelled) setViewings(viewings);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [listing.id, session.access_token]);

  useEffect(() => {
    let cancelled = false;
    fetchListingOffers(session.access_token, listing.id)
      .then(({ offers }) => {
        if (!cancelled) setOffers(offers);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [listing.id, session.access_token]);

  useEffect(() => {
    let cancelled = false;
    fetchListingContract(session.access_token, listing.id)
      .then(({ contract }) => {
        if (!cancelled) setContract(contract);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [listing.id, session.access_token]);

  useEffect(() => {
    let cancelled = false;
    fetchListingClosing(session.access_token, listing.id)
      .then(({ closing }) => {
        if (!cancelled) setClosing(closing);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [listing.id, session.access_token]);

  useEffect(() => {
    if (!closing) return;
    let cancelled = false;
    fetchClosingCommissionEarnings(session.access_token, closing.id)
      .then(({ commission_earnings }) => {
        if (!cancelled) setCommissionEarnings(commission_earnings);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [closing, session.access_token]);

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

  // Links out to UP NOAH's public hazard-lookup tool rather than embedding it --
  // it has no deep-linking support (confirmed 2026-08-08: URL query params are
  // ignored, all location state is client-side only), so the best we can do is
  // copy the address for the agent to paste into NOAH's own search box.
  // Clipboard write must happen before window.open(), not after -- once the new
  // tab opens it steals document focus, and Clipboard.writeText() throws on an
  // unfocused document.
  // NOAH's own search box only geocodes on a dropdown-suggestion click -- its
  // search/magnifying-glass button and Enter are both no-ops that silently leave
  // the pin at NOAH's default location (confirmed 2026-08-08 against a real
  // listing address). The on-screen instructions below call this out explicitly.
  function handleCheckHazardRisk() {
    const street = listing.property_address ?? listing.property_title;
    // City is appended so NOAH's geocoder (a generic Mapbox search, not
    // NOAH-specific) has enough context to disambiguate a street name that
    // isn't unique nationwide -- property_address alone omits it.
    const address = listing.property_city ? `${street}, ${listing.property_city}` : street;
    navigator.clipboard
      .writeText(address)
      .then(() => setHazardCopied(true))
      .catch(() => setHazardCopied(false))
      .finally(() => {
        window.open('https://noah.up.edu.ph/know-your-hazards', '_blank', 'noopener,noreferrer');
      });
  }

  return (
    <FloatingPanel
      title={mode === 'edit' ? 'Edit listing' : 'Listing details'}
      description={
        mode === 'edit'
          ? 'Editing here updates the listing immediately — it does not change the underlying property record.'
          : `Review what clients see before you share it. ${listing.property_title}.`
      }
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
              <dt className="text-tertiary-foreground">Property</dt>
              <dd className="font-medium">{listing.property_title}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-tertiary-foreground">Type</dt>
              <dd className="capitalize">{listing.listing_type}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-tertiary-foreground">Price</dt>
              <dd className="font-mono">
                {listing.price_currency} {listing.price.toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-tertiary-foreground">Exclusivity</dt>
              <dd>
                <Badge variant={listing.exclusivity === 'exclusive' ? 'warning' : 'neutral'}>
                  {listing.exclusivity === 'exclusive' ? 'Exclusive' : 'Open'}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-tertiary-foreground">Authority to Sell/Lease</dt>
              <dd className="whitespace-nowrap text-right font-mono">
                {new Date(listing.authority_starts_at).toLocaleDateString()}
                {' – '}
                {listing.authority_expires_at
                  ? new Date(listing.authority_expires_at).toLocaleDateString()
                  : 'open-ended'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-tertiary-foreground">Status</dt>
              <dd>
                <Badge variant={LISTING_STATUS_VARIANT[listing.status]}>{STATUS_LABEL[listing.status]}</Badge>
              </dd>
            </div>
            {listing.status === 'expired' && (
              <p className="text-xs text-destructive">{authorityWarningLabel(listing.listing_type)}</p>
            )}
            {listing.status === 'sold' && listing.buyer_name && (
              <div className="flex justify-between gap-4">
                <dt className="text-tertiary-foreground">Buyer</dt>
                <dd>{listing.buyer_name}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-tertiary-foreground">Created</dt>
              <dd className="font-mono">{new Date(listing.created_at).toLocaleDateString()}</dd>
            </div>
          </dl>

          {viewings.length > 0 && (
            <div className="space-y-1 rounded-md border p-3">
              <p className="text-sm font-medium">Viewings</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {viewings.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2">
                    <span>{new Date(v.scheduled_at).toLocaleString()}</span>
                    <span className="capitalize">{v.outcome.replace(/_/g, ' ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {offers.length > 0 && (
            <div className="space-y-1 rounded-md border p-3">
              <p className="text-sm font-medium">Offers</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {offers.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2">
                    <span>
                      {o.offered_by === 'buyer' ? 'Buyer' : 'Seller'} {o.currency} {o.amount.toLocaleString()}
                    </span>
                    <span className="capitalize">{o.status.replace(/_/g, ' ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {contract && (
            <div className="space-y-1 rounded-md border p-3">
              <p className="text-sm font-medium">Contract</p>
              <p className="text-sm text-muted-foreground">
                {contract.currency} {contract.agreed_price.toLocaleString()} —{' '}
                <span className="capitalize">{contract.signing_status}</span>
              </p>
            </div>
          )}

          {closing && (
            <div className="space-y-1 rounded-md border p-3">
              <p className="text-sm font-medium">Closing</p>
              <p className="text-sm text-muted-foreground">
                {closing.currency} {closing.final_price.toLocaleString()} —{' '}
                {closing.completed_at
                  ? `closed ${new Date(closing.completed_at).toLocaleDateString()}`
                  : 'in progress'}
              </p>
            </div>
          )}

          {commissionEarnings && (
            <div className="space-y-1 rounded-md border p-3">
              <p className="text-sm font-medium">Commission</p>
              <p className="text-sm text-muted-foreground">
                Total: {commissionEarnings.currency} {commissionEarnings.total_commission.toLocaleString()}
              </p>
              <p className="text-sm text-muted-foreground">
                Brokerage {commissionEarnings.brokerage_pct}% / Agent {commissionEarnings.agent_pct}%
                {commissionEarnings.co_broker_pct > 0 && ` / Co-broker ${commissionEarnings.co_broker_pct}%`}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setMode('edit')}>
              Edit
            </Button>
            <Button size="sm" variant="outline" onClick={handleCheckHazardRisk}>
              Check Hazard Risk
            </Button>
            {hazardCopied && (
              <span className="text-sm text-muted-foreground">
                Address copied — paste it into NOAH's search box, then click the matching suggestion (the search
                button alone won't move the pin).
              </span>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {warning && (
            <p className="rounded-lg border border-[#EFE4C8] bg-accent px-3 py-2 text-sm text-accent-foreground">
              {warning}
            </p>
          )}

          {/* Residoro Design Language (2026-08-03) modal-footer convention:
              destructive/withdraw pinned left, the primary status-forward
              action(s) grouped right. */}
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {listing.status === 'expired' ? (
              <>
                <Button size="sm" variant="outline" className="border-[#F2D8D4] text-destructive hover:bg-[#FBECEA]" onClick={() => handleStatus('withdrawn')}>
                  Mark Withdrawn
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  <input
                    type="date"
                    value={renewDate}
                    onChange={(e) => setRenewDate(e.target.value)}
                    className="h-8 rounded-md border border-input bg-card px-2 text-sm"
                  />
                  <Button size="sm" onClick={handleRenew}>
                    Renew
                  </Button>
                </div>
              </>
            ) : (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {LISTING_STATUS_TRANSITIONS[listing.status].map((nextStatus) =>
                  nextStatus === 'sold' ? (
                    <div key="sold" className="flex items-center gap-2">
                      <select
                        value={buyerContactId}
                        onChange={(e) => setBuyerContactId(e.target.value)}
                        className="h-8 rounded-md border border-input bg-card px-2 text-sm"
                      >
                        <option value="">Select buyer…</option>
                        {contacts?.map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.name}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" disabled={!buyerContactId} onClick={handleMarkSold}>
                        Mark Sold
                      </Button>
                    </div>
                  ) : (
                    <Button key={nextStatus} size="sm" variant="outline" onClick={() => handleStatus(nextStatus)}>
                      Mark {STATUS_LABEL[nextStatus]}
                    </Button>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </FloatingPanel>
  );
}
