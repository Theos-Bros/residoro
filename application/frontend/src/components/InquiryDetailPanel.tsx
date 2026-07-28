import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  fetchInquiry,
  createInquiry,
  updateInquiry,
  qualifyInquiry,
  archiveInquiry,
  deleteInquiry,
  type Inquiry,
  type RequirementFields,
} from '@/lib/inquiriesApi';
import { fetchContacts, type Contact } from '@/lib/contactsApi';
import { FloatingPanel } from '@/components/FloatingPanel';
import { RequirementFieldsForm } from '@/components/RequirementFieldsForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  session: Session;
  inquiryId: string | 'new';
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
  onQualified: (leadId: string) => void;
  onBroadcast: () => void;
};

type BuyerFields = {
  buyer_name: string;
  buyer_phone: string;
  buyer_email: string;
  buyer_address: string;
  source: string;
};

const EMPTY_BUYER_FIELDS: BuyerFields = { buyer_name: '', buyer_phone: '', buyer_email: '', buyer_address: '', source: '' };

// tb-buyer-leads-schema-001: create + edit an Inquiry, and the one-way-door
// Qualify action that promotes it into a real buyer_requirements Lead. The
// stage dropdown here deliberately only offers to_probe/probing/not_qualified
// -- 'qualified' is reachable only through the dedicated Qualify action below
// (which also creates the Lead + optional contact), never as a raw PATCH,
// so an inquiry can't end up "qualified" with no promoted_lead_id.
export function InquiryDetailPanel({ session, inquiryId, isAdmin, onClose, onSaved, onQualified, onBroadcast }: Props) {
  const navigate = useNavigate();
  const isNew = inquiryId === 'new';
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [buyerFields, setBuyerFields] = useState<BuyerFields>(EMPTY_BUYER_FIELDS);
  const [requirement, setRequirement] = useState<RequirementFields>({});
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [qualifying, setQualifying] = useState(false);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [useNewContact, setUseNewContact] = useState(true);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    fetchInquiry(session.access_token, inquiryId)
      .then((found) => {
        if (cancelled) return;
        setInquiry(found);
        setBuyerFields({
          buyer_name: found.buyer_name ?? '',
          buyer_phone: found.buyer_phone ?? '',
          buyer_email: found.buyer_email ?? '',
          buyer_address: found.buyer_address ?? '',
          source: found.source ?? '',
        });
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
  }, [inquiryId, isNew, session.access_token]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        await createInquiry(session.access_token, { ...buyerFields, ...requirement });
      } else {
        await updateInquiry(session.access_token, inquiryId, { ...buyerFields, ...requirement });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleStage(stage: 'to_probe' | 'probing' | 'not_qualified') {
    if (isNew) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateInquiry(session.access_token, inquiryId, { stage });
      setInquiry(updated);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (isNew) return;
    setSaving(true);
    setError(null);
    try {
      await archiveInquiry(session.access_token, inquiryId);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (isNew) return;
    setSaving(true);
    setError(null);
    try {
      await deleteInquiry(session.access_token, inquiryId);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startQualify() {
    setQualifying(true);
    if (contacts === null) {
      fetchContacts(session.access_token)
        .then(({ contacts }) => setContacts(contacts))
        .catch((err: Error) => setError(err.message));
    }
  }

  async function handleQualify() {
    if (isNew) return;
    setSaving(true);
    setError(null);
    try {
      const input = useNewContact
        ? { create_contact: { name: newContactName } }
        : { contact_id: selectedContactId };
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
      const { lead } = await qualifyInquiry(session.access_token, inquiryId, input);
      onSaved();
      // Deliberately no onClose() here -- onQualified re-points the parent's
      // open-panel state at the new Lead (LeadsPage swaps InquiryDetailPanel
      // for LeadDetailPanel); calling onClose() afterward would set that
      // state back to null in the same batch and the swap would never render.
      onQualified((lead as { id: string }).id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const title = isNew ? 'New Inquiry' : `Inquiry — ${inquiry?.buyer_name ?? '…'}`;

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
          {!isNew && inquiry && (
            <p className="text-sm text-muted-foreground">
              Stage: <span className="font-medium text-foreground">{inquiry.stage}</span>
              {inquiry.archived_at && ' (archived)'}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Buyer Name</Label>
              <Input
                value={buyerFields.buyer_name}
                onChange={(e) => setBuyerFields((f) => ({ ...f, buyer_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input
                value={buyerFields.buyer_phone}
                onChange={(e) => setBuyerFields((f) => ({ ...f, buyer_phone: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                value={buyerFields.buyer_email}
                onChange={(e) => setBuyerFields((f) => ({ ...f, buyer_email: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Source</Label>
              <Input
                value={buyerFields.source}
                onChange={(e) => setBuyerFields((f) => ({ ...f, source: e.target.value }))}
                placeholder="e.g. facebook_group, referral"
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Address</Label>
              <Input
                value={buyerFields.buyer_address}
                onChange={(e) => setBuyerFields((f) => ({ ...f, buyer_address: e.target.value }))}
              />
            </div>
          </div>

          <RequirementFieldsForm values={requirement} onChange={(patch) => setRequirement((r) => ({ ...r, ...patch }))} />

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {isNew ? 'Create Inquiry' : 'Save'}
            </Button>
            {!isNew && inquiry && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigate('/search', { state: { sourceType: 'inquiry', sourceId: inquiryId, requirement } })
                }
              >
                Search
              </Button>
            )}
            {!isNew && inquiry && (
              <Button size="sm" variant="outline" onClick={onBroadcast}>
                Buyer Wanted
              </Button>
            )}
            {!isNew && inquiry && inquiry.stage === 'to_probe' && (
              <Button size="sm" variant="outline" onClick={() => handleStage('probing')} disabled={saving}>
                Mark Probing
              </Button>
            )}
            {!isNew && inquiry && (inquiry.stage === 'to_probe' || inquiry.stage === 'probing') && (
              <Button size="sm" variant="outline" onClick={() => handleStage('not_qualified')} disabled={saving}>
                Not Qualified
              </Button>
            )}
            {!isNew && inquiry && !inquiry.archived_at && (
              <Button size="sm" variant="outline" onClick={handleArchive} disabled={saving}>
                Archive
              </Button>
            )}
            {!isNew && isAdmin && (
              <Button size="sm" variant="outline" onClick={handleDelete} disabled={saving}>
                Delete
              </Button>
            )}
          </div>

          {!isNew && inquiry && (inquiry.stage === 'to_probe' || inquiry.stage === 'probing') && (
            <div className="space-y-2 rounded-md border p-3">
              {!qualifying ? (
                <Button size="sm" onClick={startQualify}>
                  Qualify → Create Lead
                </Button>
              ) : (
                <>
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
                    <Input
                      placeholder="Contact name"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                    />
                  ) : (
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                      value={selectedContactId}
                      onChange={(e) => setSelectedContactId(e.target.value)}
                    >
                      <option value="">Select contact…</option>
                      {contacts?.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <Button size="sm" onClick={handleQualify} disabled={saving}>
                    Confirm Qualify
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </FloatingPanel>
  );
}
