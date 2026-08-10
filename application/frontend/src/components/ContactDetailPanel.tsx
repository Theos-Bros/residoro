import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchContact, createContact, updateContact, deleteContact, type Contact } from '@/lib/contactsApi';
import { FloatingPanel } from '@/components/FloatingPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  session: Session;
  contactId: string | 'new';
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
  // tb-tasks-linked-entity-display-001: mirrors LeadDetailPanel's own
  // onOpenTask -- FloatingPanel is "one at a time" (see FloatingPanel.tsx),
  // so opening a task swaps this panel out for a standalone TaskDetailPanel
  // at the parent (ContactsPage) level rather than nesting a second
  // fixed-position panel on top of this one. Undefined for the 'new' contact
  // flow, which has no id yet to link a task to.
  onOpenTask?: (taskId: string | 'new') => void;
};

// tb-crm-contacts-page-001: one form for both an individual and a company --
// the is_company toggle relabels "Full name"/"Company name" but writes to
// the same contacts row shape either way. Delete is admin-only, matching
// contacts_delete_admin RLS; a still-referenced contact surfaces the
// backend's named 409 rather than a raw error.
export function ContactDetailPanel({ session, contactId, isAdmin, onClose, onSaved, onOpenTask }: Props) {
  const isNew = contactId === 'new';
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isCompany, setIsCompany] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    fetchContact(session.access_token, contactId)
      .then((found: Contact) => {
        if (cancelled) return;
        setIsCompany(found.is_company);
        setName(found.name);
        setType(found.type);
        setEmail(found.email ?? '');
        setPhone(found.phone ?? '');
        setCompany(found.company ?? '');
        setNotes(found.notes ?? '');
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
  }, [contactId, isNew, session.access_token]);

  async function handleSave() {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!type.trim()) {
      setError('Type is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        await createContact(session.access_token, {
          name,
          type,
          is_company: isCompany,
          email: email || undefined,
          phone: phone || undefined,
          company: company || undefined,
          notes: notes || undefined,
        });
      } else {
        await updateContact(session.access_token, contactId, {
          name,
          type,
          is_company: isCompany,
          email: email || undefined,
          phone: phone || undefined,
          company: company || undefined,
          notes: notes || undefined,
        });
      }
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
      await deleteContact(session.access_token, contactId);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FloatingPanel title={isNew ? 'New Contact' : 'Contact'} onClose={onClose} className="max-w-lg sm:max-w-xl">
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!loading && (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isCompany} onChange={(e) => setIsCompany(e.target.checked)} />
            This contact is a company
          </label>

          <div className="space-y-1">
            <Label>{isCompany ? 'Company name' : 'Full name'}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label>Type</Label>
            <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="e.g. buyer_lead, co_broker, developer, owner" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          {!isCompany && (
            <div className="space-y-1">
              <Label>Company (optional)</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
          )}

          <div className="space-y-1">
            <Label>Notes</Label>
            <textarea
              className="flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {isNew ? 'Create Contact' : 'Save'}
            </Button>
            {!isNew && onOpenTask && (
              <Button size="sm" variant="outline" onClick={() => onOpenTask('new')}>
                Add Task
              </Button>
            )}
            {!isNew && isAdmin && (
              <Button size="sm" variant="outline" onClick={handleDelete} disabled={saving}>
                Delete
              </Button>
            )}
          </div>
        </div>
      )}
    </FloatingPanel>
  );
}
