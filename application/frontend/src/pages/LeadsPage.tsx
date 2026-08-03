import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchInquiries, updateInquiry, INQUIRY_STAGES, type Inquiry, type InquiryStage } from '@/lib/inquiriesApi';
import {
  fetchBuyerRequirements,
  updateBuyerRequirement,
  LEAD_STAGES,
  type BuyerRequirement,
  type LeadStage,
} from '@/lib/buyerRequirementsApi';
import { fetchListings, type Listing } from '@/lib/listingsApi';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import { Button } from '@/components/ui/button';
import { badgeVariants } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InquiryDetailPanel } from '@/components/InquiryDetailPanel';
import { QualifyInquiryModal } from '@/components/QualifyInquiryModal';
import { LeadDetailPanel } from '@/components/LeadDetailPanel';
import { BroadcastModal } from '@/components/BroadcastModal';
import { TaskDetailPanel } from '@/components/TaskDetailPanel';
import type { BroadcastEntityType } from '@/lib/broadcastApi';
import { cn } from '@/lib/utils';

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

// tb-design-system-leads-001: design doc section 08's table has an "Age"
// column (right-aligned mono) -- a pure display derivation from the
// created_at every Inquiry/BuyerRequirement already has, not a new field.
function ageLabel(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return `${Math.max(1, Math.floor(ms / 3_600_000))}h`;
  return `${days}d`;
}

// Residoro Design Language (2026-08-03): stage -> Badge variant, same
// precedent as listingsApi.ts's PROPERTY_STATUS_VARIANT/LISTING_STATUS_VARIANT.
// Kept local to LeadsPage (this tracer bullet's file boundary is this page
// only) rather than added to inquiriesApi.ts/buyerRequirementsApi.ts -- and
// none of the 4 existing Badge variants needed extending to cover it.
// InquiryStage/LeadStage don't match the design doc's illustrative stage
// names (New/Qualifying/Site visit/Offer) 1:1 -- this maps this app's real
// stages onto the same success/warning/neutral/danger temperature scale the
// mock uses, not the mock's literal hex values.
const INQUIRY_STAGE_VARIANT: Record<InquiryStage, 'success' | 'warning' | 'neutral' | 'danger'> = {
  to_probe: 'neutral',
  probing: 'warning',
  not_qualified: 'danger',
  qualified: 'success',
};

const LEAD_STAGE_VARIANT: Record<LeadStage, 'success' | 'warning' | 'neutral' | 'danger'> = {
  registered: 'neutral',
  searching: 'warning',
  stalled: 'danger',
  options_sent: 'warning',
  viewing: 'warning',
  negotiating: 'warning',
  contract_closing: 'success',
  won: 'success',
  lost: 'danger',
};

// Reuses Badge's own class recipe on a live <select> rather than swapping in
// a static <Badge> -- the Stage cell is a functioning inline-edit control
// (existing handleInlineStageChange/handleInlineInquiryStageChange), not a
// read-only chip like PropertiesListPage's Status column, so it has to stay
// a real <select> to keep that interaction working unchanged.
function stageSelectClass(variant: 'success' | 'warning' | 'neutral' | 'danger') {
  return cn(
    badgeVariants({ variant }),
    'h-7 cursor-pointer border pr-1 text-xs disabled:cursor-not-allowed disabled:opacity-60',
  );
}

function StatTile({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: number;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-r px-4 py-3 last:border-r-0">
      <span className="font-mono text-[11px] uppercase tracking-wider text-tertiary-foreground">{label}</span>
      <span className={cn('text-xl font-semibold', valueClassName)}>{value}</span>
    </div>
  );
}

// tb-buyer-leads-schema-001: one page, InquiriesSection on top (the
// spam-tolerant pre-qualification pen) and LeadsPipeline below (the real
// Leads pipeline) -- both plain filterable tables, matching this codebase's
// existing list conventions (see ListingsPage), not a drag-drop kanban board.
// tb-listings-status-ladder-001: the Leads section itself is split further,
// into an active-pipeline table and a separate Won table below it.
export function LeadsPage({ session }: Props) {
  const { status: workspaceStatus } = useWorkspaceStatus(session);
  const isAdmin = workspaceStatus?.role === 'admin';
  const navigate = useNavigate();

  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null);
  const [leads, setLeads] = useState<BuyerRequirement[] | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [qualifyingInquiry, setQualifyingInquiry] = useState<Inquiry | null>(null);

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

  // tb-listings-status-ladder-001: split the flat `leads` array into the
  // active pipeline and already-won leads for two separate page sections --
  // a client-side partition of data already fetched, no new API call.
  const activeLeads = leads?.filter((lead) => lead.stage !== 'won') ?? [];
  const wonLeads = leads?.filter((lead) => lead.stage === 'won') ?? [];

  // tb-design-system-leads-001: stat strip (design doc section 08) -- client-
  // side counts off the same `inquiries`/`leads` arrays already fetched
  // above, no new endpoint. "Stalled" (red) stands in for the mock's
  // "No next step" urgency stat -- this app has no next-step/owner field to
  // count against, but 'stalled' is the closest real state: a lead with no
  // forward motion.
  const newInquiriesCount = inquiries?.filter((i) => i.stage === 'to_probe').length ?? 0;
  const probingCount = inquiries?.filter((i) => i.stage === 'probing').length ?? 0;
  const stalledCount = leads?.filter((l) => l.stage === 'stalled').length ?? 0;

  const [savingStageId, setSavingStageId] = useState<string | null>(null);

  // Inline stage change: reuses the same PATCH LeadDetailPanel's own Stage
  // dropdown calls (updateBuyerRequirement with just { stage }), so the two
  // stay behaviorally identical. Reloads the full leads list on success
  // rather than patching local state, since a stage change into/out of
  // 'won' needs the row to move between the Leads/Won sections above.
  function handleInlineStageChange(leadId: string, stage: LeadStage) {
    setSavingStageId(leadId);
    setError(null);
    updateBuyerRequirement(session.access_token, leadId, { stage })
      .then(() => reloadLeads())
      .catch((err: Error) => setError(err.message))
      .finally(() => setSavingStageId(null));
  }

  // tb-buyer-leads-inline-stage-002: 'qualified' is deliberately excluded --
  // InquiryDetailPanel's own comment explains why: it's reachable only
  // through the dedicated Qualify action (which atomically creates the
  // promoted Lead + sets promoted_lead_id), never as a raw PATCH, so an
  // inquiry can't end up "qualified" with no promoted Lead behind it. The
  // backend itself doesn't block a raw PATCH to 'qualified' (Decision #3, no
  // transition graph) -- this is a UI-level guard mirroring the existing
  // panel's, not a new backend constraint.
  const INLINE_INQUIRY_STAGES = INQUIRY_STAGES.filter((s) => s !== 'qualified');

  function handleInlineInquiryStageChange(inquiryId: string, stage: InquiryStage) {
    setSavingStageId(inquiryId);
    setError(null);
    updateInquiry(session.access_token, inquiryId, { stage })
      .then(() => reloadInquiries())
      .catch((err: Error) => setError(err.message))
      .finally(() => setSavingStageId(null));
  }

  function renderLeadsTable(rows: BuyerRequirement[]) {
    return (
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contact</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Intent</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead>Target City</TableHead>
              <TableHead className="text-right">Age</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((lead) => (
              <TableRow
                key={lead.id}
                className="cursor-pointer"
                onClick={() => setOpenPanel({ type: 'lead', id: lead.id })}
              >
                <TableCell className="font-medium">{lead.contacts?.name ?? '—'}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <select
                    className={stageSelectClass(LEAD_STAGE_VARIANT[lead.stage])}
                    value={lead.stage}
                    disabled={savingStageId === lead.id}
                    onChange={(e) => handleInlineStageChange(lead.id, e.target.value as LeadStage)}
                  >
                    {LEAD_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell className="capitalize">{lead.intent}</TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {budgetLabel(lead.budget_min, lead.budget_max, lead.budget_currency)}
                </TableCell>
                <TableCell>{lead.target_city ?? '—'}</TableCell>
                <TableCell
                  className="whitespace-nowrap text-right font-mono text-sm text-tertiary-foreground"
                  title={new Date(lead.created_at).toLocaleString()}
                >
                  {ageLabel(lead.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Everyone who has enquired and hasn't closed yet. Pre-qualify new inquiries above, then work the
            active pipeline below — stalled leads are the ones most likely to go cold, so they're called out
            in red.
          </p>
        </div>
        {(inquiries || leads) && (
          <div className="flex divide-x overflow-hidden rounded-xl border bg-card">
            <StatTile label="New" value={newInquiriesCount} valueClassName="text-accent-foreground" />
            <StatTile label="Probing" value={probingCount} />
            <StatTile label="Active leads" value={activeLeads.length} />
            <StatTile label="Won" value={wonLeads.length} />
            <StatTile label="Stalled" value={stalledCount} valueClassName="text-destructive" />
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Inquiries</h2>
          <Button size="sm" variant="outline" onClick={() => setOpenPanel({ type: 'inquiry', id: 'new' })}>
            New Inquiry
          </Button>
        </div>
        {inquiries === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {inquiries?.length === 0 && <p className="text-sm text-muted-foreground">No open inquiries.</p>}
        {inquiries && inquiries.length > 0 && (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead>Target City</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <select
                        className={stageSelectClass(INQUIRY_STAGE_VARIANT[inquiry.stage])}
                        value={inquiry.stage}
                        disabled={savingStageId === inquiry.id || inquiry.stage === 'qualified'}
                        onChange={(e) => handleInlineInquiryStageChange(inquiry.id, e.target.value as InquiryStage)}
                      >
                        {(inquiry.stage === 'qualified'
                          ? [...INLINE_INQUIRY_STAGES, inquiry.stage]
                          : INLINE_INQUIRY_STAGES
                        ).map((s) => (
                          <option key={s} value={s}>
                            {s.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell className="capitalize">{inquiry.intent ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {budgetLabel(inquiry.budget_min, inquiry.budget_max, inquiry.budget_currency)}
                    </TableCell>
                    <TableCell>{inquiry.target_city ?? '—'}</TableCell>
                    <TableCell
                      className="whitespace-nowrap text-right font-mono text-sm text-tertiary-foreground"
                      title={new Date(inquiry.created_at).toLocaleString()}
                    >
                      {ageLabel(inquiry.created_at)}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {/* Button's own disabled state already grays it out
                          (disabled:opacity-50, ui/button.tsx) but also sets
                          disabled:pointer-events-none, which stops a native
                          disabled <button> from showing any hover cursor at
                          all (not even not-allowed) in most browsers. Wrapping
                          it in a span that keeps pointer-events lets the wrapper
                          catch the hover and render cursor-not-allowed while
                          the button itself stays fully inert. */}
                      <span className={inquiry.stage !== 'probing' ? 'cursor-not-allowed' : undefined}>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={inquiry.stage !== 'probing'}
                          onClick={() => setQualifyingInquiry(inquiry)}
                        >
                          Qualify
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {qualifyingInquiry && (
        <QualifyInquiryModal
          session={session}
          inquiryId={qualifyingInquiry.id}
          buyerName={qualifyingInquiry.buyer_name ?? ''}
          onClose={() => setQualifyingInquiry(null)}
          onQualified={() => {
            setQualifyingInquiry(null);
            reloadInquiries();
            reloadLeads();
          }}
        />
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Leads</h2>
          <Button size="sm" onClick={() => setOpenPanel({ type: 'lead', id: 'new' })}>
            New Lead
          </Button>
        </div>
        {leads === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {leads?.length === 0 && <p className="text-sm text-muted-foreground">No leads yet.</p>}
        {leads && activeLeads.length > 0 && renderLeadsTable(activeLeads)}
        {leads && leads.length > 0 && activeLeads.length === 0 && (
          <p className="text-sm text-muted-foreground">No active leads — see Won below.</p>
        )}
      </section>

      {/* tb-listings-status-ladder-001: backlog item #10 -- a won lead must not
          sit in the same list as the active pipeline. Same flat-table
          convention as above (see the comment on LeadsPage), a second
          section, not a kanban column. Listings and leads stay decoupled --
          this is a client-side partition of the same `leads` array by
          `stage`, not a new coupling to listing status. */}
      {leads && wonLeads.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Won</h2>
          </div>
          {renderLeadsTable(wonLeads)}
        </section>
      )}

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
