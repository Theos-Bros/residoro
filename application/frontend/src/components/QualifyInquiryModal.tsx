import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { qualifyInquiry } from '@/lib/inquiriesApi';
import { fetchContacts, type Contact } from '@/lib/contactsApi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = {
  session: Session;
  inquiryId: string;
  buyerName: string;
  onClose: () => void;
  onQualified: (leadId: string) => void;
};

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

// tb-buyer-leads-inquiry-qualify-001: a standalone, centered-modal version of
// the contact-entry step InquiryDetailPanel's own inline "Qualify -> Create
// Lead" flow already has (handleQualify/startQualify there) -- same
// qualifyInquiry call, same new-vs-existing-contact choice, just reachable
// directly from the Inquiries row's Qualify button instead of requiring the
// full detail panel to be open first.
export function QualifyInquiryModal({ session, inquiryId, buyerName, onClose, onQualified }: Props) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [useNewContact, setUseNewContact] = useState(true);
  const [newContactName, setNewContactName] = useState(buyerName);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchContacts(session.access_token)
      .then(({ contacts }) => setContacts(contacts))
      .catch((err: Error) => setError(err.message));
  }, [session.access_token]);

  async function handleConfirm() {
    setError(null);
    if (useNewContact && !newContactName.trim()) {
      setError('Contact name is required');
      return;
    }
    if (!useNewContact && !selectedContactId) {
      setError('Select a contact');
      return;
    }
    setSaving(true);
    try {
      const input = useNewContact ? { create_contact: { name: newContactName } } : { contact_id: selectedContactId };
      const { lead } = await qualifyInquiry(session.access_token, inquiryId, input);
      onQualified((lead as { id: string }).id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Qualify {buyerName || 'Inquiry'}</DialogTitle>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="space-y-2">
          <div className="flex gap-4 text-sm">
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

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={saving}>
            Confirm Qualify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
