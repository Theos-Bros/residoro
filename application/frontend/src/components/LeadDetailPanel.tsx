import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  fetchBuyerRequirement,
  createBuyerRequirement,
  updateBuyerRequirement,
  sendOptions,
  markWon,
  LEAD_STAGES,
  type BuyerRequirement,
  type LeadStage,
} from '@/lib/buyerRequirementsApi';
import type { RequirementFields } from '@/lib/inquiriesApi';
import { fetchContacts, type Contact } from '@/lib/contactsApi';
import type { Listing } from '@/lib/listingsApi';
import { FloatingPanel } from '@/components/FloatingPanel';
import { RequirementFieldsForm } from '@/components/RequirementFieldsForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  session: Session;
  leadId: string | 'new';
  listings: Listing[];
  onClose: () => void;
  onSaved: () => void;
  onGoMarkSold: (listingId: string, buyerContactId: string) => void;
  onBroadcast: () => void;
};

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

// tb-buyer-leads-schema-001: create + edit a Lead directly (not gated behind
// an Inquiry -- POST /buyer-requirements allows this), free-form stage
// transitions (Decision #3: forward or backward, no transition graph), a
// plain unscored options-sent picker, and a bookkeeping-only mark-won that
// hands off to the existing ListingsPage sold flow rather than writing
// listings.buyer_contact_id itself.
export function LeadDetailPanel({ session, leadId, listings, onClose, onSaved, onGoMarkSold, onBroadcast }: Props) {
  const navigate = useNavigate();
  const activeListings = listings.filter((l) => l.status === 'active');
  const isNew = leadId === 'new';
  const [lead, setLead] = useState<BuyerRequirement | null>(null);
  const [requirement, setRequirement] = useState<RequirementFields>({});
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [useNewContact, setUseNewContact] = useState(true);

  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [wonListingId, setWonListingId] = useState('');

  useEffect(() => {
    if (isNew) {
      fetchContacts(session.access_token)
        .then(({ contacts }) => setContacts(contacts))
        .catch((err: Error) => setError(err.message));
      return;
    }
    let cancelled = false;
    fetchBuyerRequirement(session.access_token, leadId)
      .then((found) => {
        if (cancelled) return;
        setLead(found);
        setRequirement(found);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, isNew, session.access_token]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        if (useNewContact && !newContactName.trim()) {
          setError('Contact name is required');
          setSaving(false);
          return;
        }
        if (!useNewContact && !selectedContactId) {
          setError('Select a contact');
          setSaving(false);
          return;
        }
        const contactInput = useNewContact
          ? { create_contact: { name: newContactName } }
          : { contact_id: selectedContactId };
        await createBuyerRequirement(session.access_token, { ...contactInput, ...requirement } as never);
      } else {
        await updateBuyerRequirement(session.access_token, leadId, requirement);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleStageChange(stage: LeadStage) {
    if (isNew) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateBuyerRequirement(session.access_token, leadId, { stage });
      // PATCH's own response doesn't embed buyer_requirement_matches (same
      // gap as sendOptions/markWon below) -- preserve whatever was already
      // loaded rather than letting a plain stage change wipe the Options
      // Sent list out of view.
      setLead((prev) => (prev ? { ...updated, buyer_requirement_matches: prev.buyer_requirement_matches } : updated));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendOptions() {
    if (isNew || selectedOptionIds.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // options-sent's own response embeds contacts but not
      // buyer_requirement_matches -- re-fetch so the newly-sent matches show
      // up immediately instead of only after the panel is closed and reopened.
      await sendOptions(session.access_token, leadId, selectedOptionIds);
      const refreshed = await fetchBuyerRequirement(session.access_token, leadId);
      setLead(refreshed);
      setSelectedOptionIds([]);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkWon() {
    if (isNew || !wonListingId) return;
    setSaving(true);
    setError(null);
    try {
      // Same embed gap as sendOptions -- mark-won's own response doesn't
      // include buyer_requirement_matches either, so re-fetch to keep the
      // Options Sent list visible alongside the new Won banner.
      await markWon(session.access_token, leadId, wonListingId);
      const refreshed = await fetchBuyerRequirement(session.access_token, leadId);
      setLead(refreshed);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const title = isNew ? 'New Lead' : `Lead — ${lead?.contacts?.name ?? '…'}`;
  const matches = lead?.buyer_requirement_matches ?? [];

  return (
    <FloatingPanel title={title} onClose={onClose} className="max-w-lg sm:max-w-xl">
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!loading && (
        <div className="space-y-4">
          {isNew && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex gap-2 text-sm">
                <label className="flex items-center gap-1">
                  <input type="radio" checked={useNewContact} onChange={() => setUseNewContact(true)} />
                  New contact
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" checked={!useNewContact} onChange={() => setUseNewContact(false)} />
                  Existing contact
                </label>
              </div>
              {useNewContact ? (
                <Input placeholder="Contact name" value={newContactName} onChange={(e) => setNewContactName(e.target.value)} />
              ) : (
                <select className={selectClass} value={selectedContactId} onChange={(e) => setSelectedContactId(e.target.value)}>
                  <option value="">Select contact…</option>
                  {contacts?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {!isNew && lead && (
            <div className="space-y-1">
              <Label>Stage</Label>
              <select
                className={selectClass}
                value={lead.stage}
                onChange={(e) => handleStageChange(e.target.value as LeadStage)}
              >
                {LEAD_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          )}

          <RequirementFieldsForm values={requirement} onChange={(patch) => setRequirement((r) => ({ ...r, ...patch }))} />

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {isNew ? 'Create Lead' : 'Save'}
            </Button>
            {!isNew && lead && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/search', { state: { sourceType: 'lead', sourceId: leadId, requirement } })}
              >
                Search
              </Button>
            )}
            {!isNew && lead && (
              <Button size="sm" variant="outline" onClick={onBroadcast}>
                Buyer Wanted
              </Button>
            )}
          </div>

          {!isNew && lead && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Send Options (active listings)</p>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {activeListings.map((listing) => (
                  <label key={listing.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedOptionIds.includes(listing.id)}
                      onChange={(e) =>
                        setSelectedOptionIds((prev) =>
                          e.target.checked ? [...prev, listing.id] : prev.filter((id) => id !== listing.id),
                        )
                      }
                    />
                    {listing.property_title} — {listing.price_currency} {listing.price.toLocaleString()}
                  </label>
                ))}
                {activeListings.length === 0 && <p className="text-xs text-muted-foreground">No active listings.</p>}
              </div>
              <Button size="sm" variant="outline" onClick={handleSendOptions} disabled={saving || selectedOptionIds.length === 0}>
                Send Selected as Options
              </Button>
            </div>
          )}

          {!isNew && matches.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Options Sent</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {matches.map((m) => {
                  const listing = listings.find((l) => l.id === m.listing_id);
                  return (
                    <li key={m.id}>
                      {listing?.property_title ?? m.listing_id} — score: {m.score ?? '—'}
                    </li>
                  );
                })}
              </ul>

              {lead && lead.stage !== 'won' && (
                <div className="flex items-center gap-2">
                  <select className={selectClass} value={wonListingId} onChange={(e) => setWonListingId(e.target.value)}>
                    <option value="">Select won listing…</option>
                    {matches.map((m) => {
                      const listing = listings.find((l) => l.id === m.listing_id);
                      return (
                        <option key={m.id} value={m.listing_id}>
                          {listing?.property_title ?? m.listing_id}
                        </option>
                      );
                    })}
                  </select>
                  <Button size="sm" onClick={handleMarkWon} disabled={saving || !wonListingId}>
                    Mark Won
                  </Button>
                </div>
              )}
            </div>
          )}

          {!isNew && lead && lead.stage === 'won' && lead.won_listing_id && (
            <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3">
              <p className="text-sm text-emerald-900">
                Won: {listings.find((l) => l.id === lead.won_listing_id)?.property_title ?? lead.won_listing_id}
              </p>
              <Button size="sm" onClick={() => onGoMarkSold(lead.won_listing_id!, lead.contact_id)}>
                Mark Sold on Listings Page
              </Button>
            </div>
          )}
        </div>
      )}
    </FloatingPanel>
  );
}
