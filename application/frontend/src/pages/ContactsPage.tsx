import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useLocation } from 'react-router-dom';
import { fetchContacts, type Contact } from '@/lib/contactsApi';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ContactDetailPanel } from '@/components/ContactDetailPanel';
import { useHighlightFromSearch } from '@/hooks/useHighlightFromSearch';
import { cn } from '@/lib/utils';

type Props = {
  session: Session;
};

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'company', label: 'Companies' },
  { value: 'individual', label: 'Individuals' },
] as const;

const selectClass = 'flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

// tb-crm-contacts-page-001: a single filterable table, matching this
// codebase's existing list conventions (see LeadsPage, TasksPage) rather
// than a new UI pattern -- replaces today's scattered Developer/Owner/Buyer
// pickers for the "browse my contacts" use case, without changing those
// pickers themselves (see semantic_scope).
export function ContactsPage({ session }: Props) {
  const { status: workspaceStatus } = useWorkspaceStatus(session);
  const isAdmin = workspaceStatus?.role === 'admin';
  const location = useLocation();

  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('all');
  const [error, setError] = useState<string | null>(null);
  const [openContactId, setOpenContactId] = useState<string | 'new' | null>(null);
  const { highlightedId, clearHighlight } = useHighlightFromSearch(contacts !== null);

  // tb-listings-co-broker-share-contact-gate-001: ShareDocketModal's "add
  // @handle as a contact" shortcut on a 403 rejection navigates here with
  // this state, so the dead-end case is a two-click fix (click the
  // shortcut, click Create Contact) rather than a fresh manual lookup.
  // Mirrors useHighlightFromSearch's location.state convention.
  const prefillLinkedHandle = (location.state as { prefillLinkedHandle?: string } | null)?.prefillLinkedHandle;

  useEffect(() => {
    if (prefillLinkedHandle) setOpenContactId('new');
    // Only react to a fresh navigation (location.key changes per nav);
    // re-running on every render would re-open the panel after the user
    // closes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  function reload() {
    fetchContacts(session.access_token, filter === 'all' ? undefined : { isCompany: filter === 'company' })
      .then(({ contacts }) => setContacts(contacts))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reload, [session.access_token, filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <Button size="sm" onClick={() => setOpenContactId('new')}>
          New Contact
        </Button>
      </div>

      <select className={selectClass} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
        {FILTERS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {contacts === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {contacts?.length === 0 && <p className="text-sm text-muted-foreground">No contacts match this filter.</p>}
      {contacts && contacts.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  data-row-id={contact.id}
                  className={cn('cursor-pointer', highlightedId === contact.id && 'bg-amber-100')}
                  onClick={() => {
                    clearHighlight();
                    setOpenContactId(contact.id);
                  }}
                >
                  <TableCell className="font-medium">{contact.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{contact.type}</TableCell>
                  <TableCell>
                    <Badge variant={contact.is_company ? 'default' : 'secondary'}>
                      {contact.is_company ? 'Company' : 'Individual'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{contact.email ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{contact.phone ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {openContactId && (
        <ContactDetailPanel
          session={session}
          contactId={openContactId}
          isAdmin={isAdmin}
          onClose={() => setOpenContactId(null)}
          onSaved={reload}
          prefillLinkedHandle={openContactId === 'new' ? prefillLinkedHandle : undefined}
        />
      )}
    </div>
  );
}
