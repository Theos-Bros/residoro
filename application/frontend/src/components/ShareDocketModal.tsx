import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useNavigate } from 'react-router-dom';
import {
  createDocket,
  DOCKET_LISTING_FIELDS,
  DOCKET_PROPERTY_FIELDS,
  type DocketField,
} from '@/lib/listingsApi';
import { fetchContacts, type Contact } from '@/lib/contactsApi';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// tb-listings-co-broker-share-contact-gate-001: substring match against
// dockets.ts's exact 403 message for the new contact-gate check -- used to
// distinguish "not on your contact list" from every other createDocket
// failure (handle not found, self-share, validation, etc.), since
// parseJsonOrThrow only throws a plain Error with no status code attached.
const CONTACT_GATE_ERROR_SUBSTRING = 'only share with people on your contact list';

type Props = {
  session: Session;
  listingId: string;
  onClose: () => void;
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

// tb-listings-share-docket-modal-001: centered/dimmed-modal re-skin of the
// former ShareDocketForm route page -- field-selection logic, presets, and
// the createDocket() call are unchanged, just moved into ui/dialog.tsx (the
// primitive tb-buyer-leads-inquiry-qualify-001 built), matching
// QualifyInquiryModal's usage.
export function ShareDocketModal({ session, listingId, onClose }: Props) {
  const navigate = useNavigate();
  const [handle, setHandle] = useState('');
  const [selectedFields, setSelectedFields] = useState<Set<DocketField>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [linkedContacts, setLinkedContacts] = useState<Contact[]>([]);
  const [contactsLoadError, setContactsLoadError] = useState<string | null>(null);

  // Contacts with a linked handle are the "pick from contacts" path
  // alongside the existing @handle input -- both land on the same `handle`
  // state before submit. Filtered client-side per the Technical Design
  // (reuse fetchContacts, no new backend endpoint for this).
  useEffect(() => {
    let cancelled = false;
    fetchContacts(session.access_token)
      .then(({ contacts }) => {
        if (cancelled) return;
        setLinkedContacts(contacts.filter((c) => !!c.linked_handle));
      })
      .catch((err: Error) => {
        if (!cancelled) setContactsLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session.access_token]);

  const isContactGateError = !!error && error.includes(CONTACT_GATE_ERROR_SUBSTRING);

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
        listing_id: listingId,
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share as docket</DialogTitle>
          <DialogDescription>Choose which fields the recipient can see.</DialogDescription>
        </DialogHeader>

        {success ? (
          <>
            <p className="text-sm text-muted-foreground">
              @{handle.trim()} can now see this listing in their "Shared with me" view.
            </p>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="handle">Recipient&apos;s @handle</Label>
              <Input id="handle" type="text" value={handle} onChange={(e) => setHandle(e.target.value)} required />

              {linkedContacts.length > 0 && (
                <div className="pt-1">
                  <Label htmlFor="contact-picker" className="text-xs text-muted-foreground">
                    Or pick from your contacts
                  </Label>
                  <select
                    id="contact-picker"
                    className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setHandle(e.target.value);
                    }}
                  >
                    <option value="">Select a contact…</option>
                    {linkedContacts.map((contact) => (
                      <option key={contact.id} value={contact.linked_handle ?? ''}>
                        {contact.name} (@{contact.linked_handle})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {contactsLoadError && (
                <p className="text-xs text-muted-foreground">Could not load your contacts: {contactsLoadError}</p>
              )}
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

            {error && (
              <div role="alert" className="space-y-2">
                <p className="text-sm text-destructive">{error}</p>
                {isContactGateError && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate('/contacts', { state: { prefillLinkedHandle: handle.trim().toLowerCase() } })
                    }
                  >
                    Add @{handle.trim()} as a contact
                  </Button>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? 'Sharing…' : 'Share docket'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
