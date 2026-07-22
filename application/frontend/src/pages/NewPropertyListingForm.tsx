import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { createProperty, createListing, type PropertyType, type OwnerType } from '@/lib/listingsApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

const inputClass = 'w-full rounded-md border border-input px-3 py-2 text-sm';

const PROPERTY_TYPES: PropertyType[] = [
  'condo_unit',
  'house_and_lot',
  'lot_only',
  'townhouse',
  'commercial',
  'warehouse',
  'agricultural',
  'industrial',
];

const OWNER_TYPES: OwnerType[] = ['developer', 'individual', 'company'];

// tb-listings-new-property-001: the "I just got a new listing" moment for a
// property that isn't in residoro yet -- creates a properties row and a
// listings row together in one submit. Reuses POST /listings unchanged
// against the newly-created property_id; the listing fields below mirror
// CreateListingForm's exactly. owner_id is never collected here -- stays
// NULL, matching Migration's existing behavior (cap-properties-001
// Decision #2).
export function NewPropertyListingForm({ session }: Props) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<PropertyType>('condo_unit');
  const [ownerType, setOwnerType] = useState<OwnerType>('individual');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [askPrice, setAskPrice] = useState('');

  const [listingType, setListingType] = useState<'sale' | 'rent'>('sale');
  const [price, setPrice] = useState('');
  const [exclusivity, setExclusivity] = useState<'exclusive' | 'open'>('open');
  const [authorityStartsAt, setAuthorityStartsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [authorityExpiresAt, setAuthorityExpiresAt] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError('Listing price must be a positive number.');
      return;
    }

    const numericAskPrice = askPrice ? Number(askPrice) : undefined;
    if (askPrice && (!Number.isFinite(numericAskPrice) || (numericAskPrice as number) < 0)) {
      setError("Owner's ask price must be a non-negative number.");
      return;
    }

    setSubmitting(true);
    try {
      const property = await createProperty(session.access_token, {
        title: title.trim(),
        type,
        owner_type: ownerType,
        address: address || undefined,
        city: city || undefined,
        province: province || undefined,
        price: numericAskPrice,
      });

      await createListing(session.access_token, {
        property_id: property.id,
        listing_type: listingType,
        price: numericPrice,
        exclusivity,
        authority_starts_at: authorityStartsAt ? new Date(authorityStartsAt).toISOString() : undefined,
        authority_expires_at: authorityExpiresAt ? new Date(authorityExpiresAt).toISOString() : null,
      });

      navigate('/properties', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-semibold">Add a new listing</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="title" className="text-sm font-medium">
            Property title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="type" className="text-sm font-medium">
            Property type
          </label>
          <select
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value as PropertyType)}
            className={inputClass}
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="owner_type" className="text-sm font-medium">
            Owner type
          </label>
          <select
            id="owner_type"
            value={ownerType}
            onChange={(e) => setOwnerType(e.target.value as OwnerType)}
            className={inputClass}
          >
            {OWNER_TYPES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="address" className="text-sm font-medium">
            Address (optional)
          </label>
          <input id="address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="city" className="text-sm font-medium">
            City (optional)
          </label>
          <input id="city" type="text" value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="province" className="text-sm font-medium">
            Province (optional)
          </label>
          <input
            id="province"
            type="text"
            value={province}
            onChange={(e) => setProvince(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ask_price" className="text-sm font-medium">
            Owner&apos;s ask price (optional, PHP)
          </label>
          <input
            id="ask_price"
            type="number"
            min="0"
            step="0.01"
            value={askPrice}
            onChange={(e) => setAskPrice(e.target.value)}
            className={inputClass}
          />
        </div>

        <hr className="my-6" />
        <h2 className="text-lg font-semibold">Listing details</h2>

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
          {submitting ? 'Creating…' : 'Add listing'}
        </Button>
      </form>
    </div>
  );
}
