import { useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createListing } from '@/lib/listingsApi';
import { Button } from '@/components/ui/button';
import { FloatingPanel } from '@/components/FloatingPanel';

type Props = {
  session: Session;
  propertyId: string;
  propertyTitle: string;
  onClose: () => void;
  onCreated: () => void;
};

const inputClass = 'w-full rounded-md border border-input px-3 py-2 text-sm';

// tb-listings-create-001: creates a listing (type, price) against a property.
// Always creates as 'draft' and always assigns agent_id = the caller
// (request.user!.id server-side) -- there's no cross-agent assignment in
// this tracer bullet's scope.
//
// tb-listings-lifecycle-001 (UX follow-up): renders inside a FloatingPanel
// (bottom-right, Messenger/Gmail-compose style) instead of a full-page route
// -- propertyId now comes from a prop, not useParams, and success closes the
// panel via onCreated() instead of navigating away.
export function CreateListingPanel({ session, propertyId, propertyTitle, onClose, onCreated }: Props) {
  const [listingType, setListingType] = useState<'sale' | 'rent'>('sale');
  const [price, setPrice] = useState('');
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
        <div>
          <label htmlFor="listing_type" className="text-sm font-medium">
            Listing type
          </label>
          <select
            id="listing_type"
            value={listingType}
            onChange={(e) => setListingType(e.target.value as 'sale' | 'rent')}
            className={inputClass}
          >
            <option value="sale">Sale</option>
            <option value="rent">Rent</option>
          </select>
        </div>
        <div>
          <label htmlFor="price" className="text-sm font-medium">
            Price (PHP)
          </label>
          <input
            id="price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="exclusivity" className="text-sm font-medium">
            Exclusivity
          </label>
          <select
            id="exclusivity"
            value={exclusivity}
            onChange={(e) => setExclusivity(e.target.value as 'exclusive' | 'open')}
            className={inputClass}
          >
            <option value="open">Open (non-exclusive)</option>
            <option value="exclusive">Exclusive</option>
          </select>
        </div>
        <div>
          <label htmlFor="authority_starts_at" className="text-sm font-medium">
            Authority to Sell/Lease starts
          </label>
          <input
            id="authority_starts_at"
            type="date"
            value={authorityStartsAt}
            onChange={(e) => setAuthorityStartsAt(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="authority_expires_at" className="text-sm font-medium">
            Authority to Sell/Lease ends (optional)
          </label>
          <input
            id="authority_expires_at"
            type="date"
            value={authorityExpiresAt}
            onChange={(e) => setAuthorityExpiresAt(e.target.value)}
            className={inputClass}
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
