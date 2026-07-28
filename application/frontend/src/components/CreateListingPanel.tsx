import { useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createListing } from '@/lib/listingsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FloatingPanel } from '@/components/FloatingPanel';

type Props = {
  session: Session;
  propertyId: string;
  propertyTitle: string;
  initialPrice?: number | null;
  initialPriceCurrency?: string;
  onClose: () => void;
  onCreated: () => void;
};

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

// tb-listings-create-001: creates a listing (type, price) against a property.
// Always creates as 'draft' and always assigns agent_id = the caller
// (request.user!.id server-side) -- there's no cross-agent assignment in
// this tracer bullet's scope.
//
// tb-listings-lifecycle-001 (UX follow-up): renders inside a FloatingPanel
// (bottom-right, Messenger/Gmail-compose style) instead of a full-page route
// -- propertyId now comes from a prop, not useParams, and success closes the
// panel via onCreated() instead of navigating away.
// tb-listings-autofill-from-property-001: price seeds from the property's own
// price on file (passed in as initialPrice), falling back to blank when the
// property has none -- still a normal editable field either way. Currency
// isn't handled here: createListing's payload has no currency field today,
// so initialPriceCurrency is only accepted for forward-compatibility and
// currently unused (see listingsApi.ts's createListing input type).
export function CreateListingPanel({ session, propertyId, propertyTitle, initialPrice, onClose, onCreated }: Props) {
  const [listingType, setListingType] = useState<'sale' | 'rent'>('sale');
  const [price, setPrice] = useState(initialPrice != null ? String(initialPrice) : '');
  const [exclusivity, setExclusivity] = useState<'exclusive' | 'open'>('open');
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
      await createListing(session.access_token, {
        property_id: propertyId,
        listing_type: listingType,
        price: numericPrice,
        exclusivity,
        authority_starts_at: authorityStartsAt ? new Date(authorityStartsAt).toISOString() : undefined,
        authority_expires_at: authorityExpiresAt ? new Date(authorityExpiresAt).toISOString() : null,
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FloatingPanel title="Create listing" documentTitle={`${propertyTitle} · Residoro`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="listing_type">Listing type</Label>
          <select
            id="listing_type"
            value={listingType}
            onChange={(e) => setListingType(e.target.value as 'sale' | 'rent')}
            className={selectClass}
          >
            <option value="sale">Sale</option>
            <option value="rent">Rent</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="price">Price (PHP)</Label>
          <Input
            id="price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exclusivity">Exclusivity</Label>
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
        <div className="space-y-1.5">
          <Label htmlFor="authority_starts_at">Authority to Sell/Lease starts</Label>
          <Input
            id="authority_starts_at"
            type="date"
            value={authorityStartsAt}
            onChange={(e) => setAuthorityStartsAt(e.target.value)}
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
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create listing'}
        </Button>
      </form>
    </FloatingPanel>
  );
}
