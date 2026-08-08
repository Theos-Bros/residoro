import { useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createListing, updateListingFields, type Listing } from '@/lib/listingsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { FloatingPanel } from '@/components/FloatingPanel';

type Props = {
  session: Session;
  propertyId: string;
  propertyTitle: string;
  initialPrice?: number | null;
  initialPriceCurrency?: string;
  onClose: () => void;
  onSaved: () => void;
  // Cancel button target -- defaults to onClose (dismiss the panel) when
  // omitted, but ListingDetailModal's embedded edit form overrides this to
  // go back to view mode instead of closing the whole modal.
  onCancel?: () => void;
  // tb-listings-detail-edit-modal-001: when present, the form edits this
  // existing listing's type/price/exclusivity (via updateListingFields)
  // instead of creating a new one. Authority dates aren't editable here --
  // that's still the separate renewal flow, relocated but unchanged, in
  // ListingDetailModal.
  editingListing?: Listing;
  // When rendered inside another FloatingPanel consumer (ListingDetailModal),
  // skip this component's own FloatingPanel wrapper -- only the form itself.
  embedded?: boolean;
};

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

// tb-listings-create-001: creates a listing (type, price) against a property.
// Always assigns agent_id = the caller (request.user!.id server-side) --
// there's no cross-agent assignment in this tracer bullet's scope.
// tb-listings-property-specs-001: creates as 'active' now, not 'draft' -- see
// POST /listings' own comment in listings.ts for why.
//
// tb-listings-lifecycle-001 (UX follow-up): renders inside a FloatingPanel
// (bottom-right, Messenger/Gmail-compose style) instead of a full-page route
// -- propertyId now comes from a prop, not useParams, and success closes the
// panel via onSaved() instead of navigating away.
// tb-listings-autofill-from-property-001: price seeds from the property's own
// price on file (passed in as initialPrice), falling back to blank when the
// property has none -- still a normal editable field either way. Currency
// isn't handled here: createListing's payload has no currency field today,
// so initialPriceCurrency is only accepted for forward-compatibility and
// currently unused (see listingsApi.ts's createListing input type).
export function CreateListingPanel({
  session,
  propertyId,
  propertyTitle,
  initialPrice,
  onClose,
  onSaved,
  onCancel,
  editingListing,
  embedded,
}: Props) {
  const isEditing = editingListing !== undefined;
  const [listingType, setListingType] = useState<'sale' | 'lease'>(editingListing?.listing_type ?? 'sale');
  const [price, setPrice] = useState(
    editingListing ? String(editingListing.price) : initialPrice != null ? String(initialPrice) : '',
  );
  const [exclusivity, setExclusivity] = useState<'exclusive' | 'open'>(editingListing?.exclusivity ?? 'open');
  const [authorityStartsAt, setAuthorityStartsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [authorityExpiresAt, setAuthorityExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError('Price must be a positive number.');
      return;
    }

    setSubmitting(true);
    try {
      if (isEditing) {
        await updateListingFields(session.access_token, editingListing.id, {
          listing_type: listingType,
          price: numericPrice,
          exclusivity,
        });
      } else {
        await createListing(session.access_token, {
          property_id: propertyId,
          listing_type: listingType,
          price: numericPrice,
          exclusivity,
          authority_starts_at: authorityStartsAt ? new Date(authorityStartsAt).toISOString() : undefined,
          authority_expires_at: authorityExpiresAt ? new Date(authorityExpiresAt).toISOString() : null,
        });
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const form = (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="listing_type">
            Listing type <span className="text-primary">*</span>
          </Label>
          <select
            id="listing_type"
            value={listingType}
            onChange={(e) => setListingType(e.target.value as 'sale' | 'lease')}
            className={selectClass}
          >
            <option value="sale">Sale</option>
            <option value="lease">Lease</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="price">
            Price (PHP) <span className="text-primary">*</span>
          </Label>
          <MoneyInput id="price" value={price} onChange={setPrice} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exclusivity">
            Exclusivity <span className="text-primary">*</span>
          </Label>
          <select
            id="exclusivity"
            value={exclusivity}
            onChange={(e) => setExclusivity(e.target.value as 'exclusive' | 'open')}
            className={selectClass}
          >
            <option value="open">Open (non-exclusive)</option>
            <option value="exclusive">Exclusive</option>
          </select>
        </div>
        {!isEditing && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="authority_starts_at">
                Authority to Sell/Lease starts <span className="text-primary">*</span>
              </Label>
              <Input
                id="authority_starts_at"
                type="date"
                value={authorityStartsAt}
                onChange={(e) => setAuthorityStartsAt(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="authority_expires_at">Authority to Sell/Lease ends (optional)</Label>
              <Input
                id="authority_expires_at"
                type="date"
                value={authorityExpiresAt}
                onChange={(e) => setAuthorityExpiresAt(e.target.value)}
              />
            </div>
          </>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {/* Residoro Design Language (2026-08-03) modal-footer convention:
            cancel + confirm, in that order, confirm rightmost. */}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" disabled={submitting} onClick={onCancel ?? onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : isEditing ? 'Save changes' : 'Create listing'}
          </Button>
        </div>
      </form>
  );

  if (embedded) return form;

  return (
    <FloatingPanel title={isEditing ? 'Edit listing' : 'Create listing'} documentTitle={`${propertyTitle} · Residoro`} onClose={onClose}>
      {form}
    </FloatingPanel>
  );
}
