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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  session: Session;
};

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
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Docket shared</h1>
        <p className="text-sm text-muted-foreground">
          @{handle.trim()} can now see this listing in their "Shared with me" view.
        </p>
        <Button onClick={() => navigate('/listings', { replace: true })}>Back to listings</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Share as docket</h1>
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="handle">Recipient&apos;s @handle</Label>
              <Input id="handle" type="text" value={handle} onChange={(e) => setHandle(e.target.value)} required />
            </div>

            <div className="flex flex-wrap gap-2">
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

            <fieldset className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Listing fields</legend>
              <div className="grid grid-cols-2 gap-2">
                {DOCKET_LISTING_FIELDS.map((field) => (
                  <label key={field} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedFields.has(field)}
                      onChange={() => toggleField(field)}
                      className="h-4 w-4 rounded border-input"
                    />
                    {field.replace(/_/g, ' ')}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Property fields</legend>
              <div className="grid grid-cols-2 gap-2">
                {DOCKET_PROPERTY_FIELDS.map((field) => (
                  <label key={field} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedFields.has(field)}
                      onChange={() => toggleField(field)}
                      className="h-4 w-4 rounded border-input"
                    />
                    {field.replace(/_/g, ' ')}
                  </label>
                ))}
              </div>
            </fieldset>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Sharing…' : 'Share docket'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
