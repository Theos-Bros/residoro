import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchInquiries, type Inquiry } from '@/lib/inquiriesApi';
import { fetchBuyerRequirements, type BuyerRequirement } from '@/lib/buyerRequirementsApi';
import { fetchListings, type Listing } from '@/lib/listingsApi';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InquiryDetailPanel } from '@/components/InquiryDetailPanel';
import { LeadDetailPanel } from '@/components/LeadDetailPanel';
import { BroadcastModal } from '@/components/BroadcastModal';
import { TaskDetailPanel } from '@/components/TaskDetailPanel';
import type { BroadcastEntityType } from '@/lib/broadcastApi';

type Props = {
  session: Session;
};

type OpenPanel =
  | { type: 'inquiry' | 'lead'; id: string | 'new' }
  | { type: 'broadcast'; entityType: BroadcastEntityType; id: string }
  // tb-tasks-crud-001: swaps out the Lead panel (FloatingPanel is "one at a
  // time") -- returnToLeadId lets closing this panel go back to the Lead it
  // was opened from, rather than closing everything.
  | { type: 'task'; taskId: string | 'new'; returnToLeadId: string }
  | null;

function budgetLabel(min?: number | null, max?: number | null, currency?: string | null): string {
  if (!min && !max) return '—';
  const cur = currency ?? 'PHP';
  if (min && max) return `${cur} ${min.toLocaleString()}–${max.toLocaleString()}`;
  return `${cur} ${(min ?? max)!.toLocaleString()}`;
}

// tb-buyer-leads-schema-001: one page, InquiriesSection on top (the
// spam-tolerant pre-qualification pen) and LeadsPipeline below (the real
// Leads pipeline) -- both plain filterable tables, matching this codebase's
// existing list conventions (see ListingsPage), not a drag-drop kanban board.
export function LeadsPage({ session }: Props) {
  const { status: workspaceStatus } = useWorkspaceStatus(session);
  const isAdmin = workspaceStatus?.role === 'admin';
  const navigate = useNavigate();

  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null);
  const [leads, setLeads] = useState<BuyerRequirement[] | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);

  function reloadInquiries() {
    fetchInquiries(session.access_token)
      .then(({ inquiries }) => setInquiries(inquiries))
      .catch((err: Error) => setError(err.message));
  }

  function reloadLeads() {
    fetchBuyerRequirements(session.access_token)
      .then(({ buyer_requirements }) => setLeads(buyer_requirements))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    reloadInquiries();
    reloadLeads();
    fetchListings(session.access_token)
      .then(({ listings }) => setListings(listings))
      .catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token]);

  function handleGoMarkSold(listingId: string, buyerContactId: string) {
    setOpenPanel(null);
    navigate('/listings', { state: { prefillListingId: listingId, prefillBuyerContactId: buyerContactId } });
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Inquiries</h2>
          <Button size="sm" onClick={() => setOpenPanel({ type: 'inquiry', id: 'new' })}>
            New Inquiry
          </Button>
        </div>
        {inquiries === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {inquiries?.length === 0 && <p className="text-sm text-muted-foreground">No open inquiries.</p>}
        {inquiries && inquiries.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Target City</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inquiries.map((inquiry) => (
                  <TableRow
                    key={inquiry.id}
                    className="cursor-pointer"
                    onClick={() => setOpenPanel({ type: 'inquiry', id: inquiry.id })}
                  >
                    <TableCell className="font-medium">{inquiry.buyer_name || '(no name)'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{inquiry.stage.replace(/_/g, ' ')}</Badge>
                    </TableCell>
                    <TableCell className="capitalize">{inquiry.intent ?? '—'}</TableCell>
                    <TableCell>{budgetLabel(inquiry.budget_min, inquiry.budget_max, inquiry.budget_currency)}</TableCell>
                    <TableCell>{inquiry.target_city ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(inquiry.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Leads</h2>
          <Button size="sm" onClick={() => setOpenPanel({ type: 'lead', id: 'new' })}>
            New Lead
          </Button>
        </div>
        {leads === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {leads?.length === 0 && <p className="text-sm text-muted-foreground">No leads yet.</p>}
        {leads && leads.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Target City</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow
                    key={lead.id}
                    className="cursor-pointer"
                    onClick={() => setOpenPanel({ type: 'lead', id: lead.id })}
                  >
                    <TableCell className="font-medium">{lead.contacts?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={lead.stage === 'won' ? 'default' : 'secondary'}>
                        {lead.stage.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize">{lead.intent}</TableCell>
                    <TableCell>{budgetLabel(lead.budget_min, lead.budget_max, lead.budget_currency)}</TableCell>
                    <TableCell>{lead.target_city ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {openPanel?.type === 'inquiry' && (
        <InquiryDetailPanel
          session={session}
          inquiryId={openPanel.id}
          isAdmin={isAdmin}
          onClose={() => setOpenPanel(null)}
          onSaved={() => {
            reloadInquiries();
            reloadLeads();
          }}
          onQualified={(leadId) => setOpenPanel({ type: 'lead', id: leadId })}
          onBroadcast={() =>
            openPanel.id !== 'new' && setOpenPanel({ type: 'broadcast', entityType: 'inquiry', id: openPanel.id })
          }
        />
      )}
      {openPanel?.type === 'lead' && (
        <LeadDetailPanel
          session={session}
          leadId={openPanel.id}
          listings={listings}
          onClose={() => setOpenPanel(null)}
          onSaved={reloadLeads}
          onGoMarkSold={handleGoMarkSold}
          onBroadcast={() =>
            openPanel.id !== 'new' &&
            setOpenPanel({ type: 'broadcast', entityType: 'buyer_requirement', id: openPanel.id })
          }
          onOpenTask={(taskId) =>
            openPanel.id !== 'new' && setOpenPanel({ type: 'task', taskId, returnToLeadId: openPanel.id })
          }
        />
      )}
      {openPanel?.type === 'broadcast' && (
        <BroadcastModal
          session={session}
          entityType={openPanel.entityType}
          entityId={openPanel.id}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {openPanel?.type === 'task' && (
        <TaskDetailPanel
          session={session}
          taskId={openPanel.taskId}
          isAdmin={isAdmin}
          prefillEntity={{ entityType: 'buyer_requirement', entityId: openPanel.returnToLeadId }}
          onClose={() => setOpenPanel({ type: 'lead', id: openPanel.returnToLeadId })}
          onSaved={() => {}}
        />
      )}
    </div>
  );
}
