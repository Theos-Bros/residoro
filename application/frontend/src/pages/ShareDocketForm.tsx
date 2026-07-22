import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  createDocket,
  DOCKET_LISTING_FIELDS,
  DOCKET_PROPERTY_FIELDS,
  type DocketField,
} from '@/lib/listingsApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

const inputClass = 'w-full rounded-md border border-input px-3 py-2 text-sm';

const ALL_FIELDS: DocketField[] = [...DOCKET_LISTING_FIELDS, ...DOCKET_PROPERTY_FIELDS];

// "Public info" excludes the exact street address, Authority to Sell/Lease
// terms, and lot/parking specifics -- a reasonable safe-subset default; the
// sharer can still hand-pick individual fields instead of using either
// preset. Presets are a pure frontend convenience -- the backend only ever
// sees the resulting field list, per the user's "true field-level
// granularity but offer presets" decision (2026-07-23).
const PUBLIC_PRESET: DocketField[] = [
  'listing_type',
  'price',
  'price_currency',
  'status',
  'title',
  'type',
  'city',
  'province',
  'floor_area_sqm',
  'bedrooms',
  'bathrooms',
];

// tb-listings-co-broker-share-001: shares a curated view of one listing with
// another individual account's @handle. included_fields is validated
// server-side against the same fixed allow-list this form renders.
export function ShareDocketForm({ session }: Props) {
  const { listingId } = useParams<{ listingId: string }>();
  const [handle, setHandle] = useState('');
  const [selectedFields, setSelectedFields] = useState<Set<DocketField>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  function toggleField(field: DocketField) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const normalizedHandle = handle.trim();
    if (!normalizedHandle) {
      setError('Recipient handle is required.');
      return;
    }
    if (selectedFields.size === 0) {
      setError('Select at least one field to share.');
      return;
    }

    setSubmitting(true);
    try {
      await createDocket(session.access_token, {
        listing_id: listingId!,
        handle: normalizedHandle,
        included_fields: [...selectedFields],
      });
      setSuccess(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="max-w-md">
        <h1 className="text-2xl font-semibold">Docket shared</h1>
        <p className="mt-4 text-sm">
          @{handle.trim()} can now see this listing in their "Shared with me" view.
        </p>
        <Button className="mt-6" onClick={() => navigate('/listings', { replace: true })}>
          Back to listings
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-semibold">Share as docket</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="handle" className="text-sm font-medium">
            Recipient&apos;s @handle
          </label>
          <input
            id="handle"
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            required
            className={inputClass}
          />
        </div>

        <div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setSelectedFields(new Set(ALL_FIELDS))}>
              Full info
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSelectedFields(new Set(PUBLIC_PRESET))}
            >
              Public info
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setSelectedFields(new Set())}>
              Clear
            </Button>
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Listing fields</legend>
          {DOCKET_LISTING_FIELDS.map((field) => (
            <label key={field} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedFields.has(field)}
                onChange={() => toggleField(field)}
              />
              {field.replace(/_/g, ' ')}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">Property fields</legend>
          {DOCKET_PROPERTY_FIELDS.map((field) => (
            <label key={field} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedFields.has(field)}
                onChange={() => toggleField(field)}
              />
              {field.replace(/_/g, ' ')}
            </label>
          ))}
        </fieldset>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Sharing…' : 'Share docket'}
        </Button>
      </form>
    </div>
  );
}
