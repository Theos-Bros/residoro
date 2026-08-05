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
import { fetchTasks, type Task } from '@/lib/tasksApi';
import { fetchLeadViewings, scheduleViewing, updateViewing, VIEWING_OUTCOMES, type Viewing } from '@/lib/viewingsApi';
import { fetchLeadOffers, recordOffer, resolveOffer, OFFERED_BY_VALUES, type Offer } from '@/lib/offersApi';
import { fetchMatchLogs, type MatchLog } from '@/lib/matchLogsApi';
import { fetchLeadContract, createContract, updateContract, type Contract, type SigningStatus } from '@/lib/contractsApi';
import { fetchLeadClosing, createClosing, updateClosing, type Closing } from '@/lib/closingsApi';
import { fetchClosingCommissionEarnings, recordCommissionEarnings, type CommissionEarnings } from '@/lib/commissionApi';
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
  // tb-tasks-crud-001: FloatingPanel is "one at a time" by this codebase's own
  // convention (see FloatingPanel.tsx) -- opening a task swaps this panel out
  // for a standalone TaskDetailPanel at the LeadsPage level (same pattern
  // onBroadcast already uses), rather than nesting a second fixed-position
  // panel on top of this one.
  onOpenTask: (taskId: string | 'new') => void;
};

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

// tb-buyer-leads-schema-001: create + edit a Lead directly (not gated behind
// an Inquiry -- POST /buyer-requirements allows this), free-form stage
// transitions (Decision #3: forward or backward, no transition graph), a
// plain unscored options-sent picker, and a bookkeeping-only mark-won that
// hands off to the existing ListingsPage sold flow rather than writing
// listings.buyer_contact_id itself.
export function LeadDetailPanel({ session, leadId, listings, onClose, onSaved, onGoMarkSold, onBroadcast, onOpenTask }: Props) {
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
  // tb-buyer-leads-revisit-page-001: only asked for -- and only required --
  // when the selected won listing is rent-type; a sale-type win never sends
  // this along (see handleMarkWon below).
  const [leaseEndDate, setLeaseEndDate] = useState('');

  // tb-tasks-crud-001: inline task list linked to this Lead
  // (entity_type='buyer_requirement'), plus a "New Task" action that
  // pre-fills the link and isn't editable from this entry point.
  const [tasks, setTasks] = useState<Task[]>([]);

  function reloadTasks() {
    if (isNew) return;
    fetchTasks(session.access_token, { entity_type: 'buyer_requirement', entity_id: leadId })
      .then(({ tasks }) => setTasks(tasks))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reloadTasks, [isNew, leadId, session.access_token]);

  // tb-transactions-viewings-001: viewings scheduled against this Lead, plus
  // the schedule-a-new-one form (listing + datetime, defaulting to the first
  // sent option if any exist).
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [viewingListingId, setViewingListingId] = useState('');
  const [viewingScheduledAt, setViewingScheduledAt] = useState('');

  function reloadViewings() {
    if (isNew) return;
    fetchLeadViewings(session.access_token, leadId)
      .then(({ viewings }) => setViewings(viewings))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reloadViewings, [isNew, leadId, session.access_token]);

  // tb-transactions-offers-001: offers/counters scheduled against this Lead,
  // plus the record-offer form (listing + amount, defaulting to a fresh
  // initial offer; "Counter" on a pending row switches the same form into
  // counter mode via counterOfferId).
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerListingId, setOfferListingId] = useState('');
  const [offerOfferedBy, setOfferOfferedBy] = useState<'buyer' | 'seller'>('buyer');
  const [offerAmount, setOfferAmount] = useState('');
  const [offerCurrency, setOfferCurrency] = useState('PHP');
  const [offerTerms, setOfferTerms] = useState('');
  const [counterOfferId, setCounterOfferId] = useState<string | null>(null);

  function reloadOffers() {
    if (isNew) return;
    fetchLeadOffers(session.access_token, leadId)
      .then(({ offers }) => setOffers(offers))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reloadOffers, [isNew, leadId, session.access_token]);

  // tb-buyer-leads-match-itinerary-001: read-only running history of "Log
  // Match" actions taken from the Search page (see SearchPage.tsx) --
  // logging/copy-text/itinerary generation themselves happen there, against
  // the ranked candidates; this panel only displays the persisted record,
  // same division of labor as viewings/offers being scheduled/recorded
  // elsewhere but shown here.
  const [matchLogs, setMatchLogs] = useState<MatchLog[]>([]);

  function reloadMatchLogs() {
    if (isNew) return;
    fetchMatchLogs(session.access_token, leadId)
      .then(({ match_logs }) => setMatchLogs(match_logs))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reloadMatchLogs, [isNew, leadId, session.access_token]);

  // tb-transactions-contract-001: the lead's current contract (most recent
  // row, if any), plus an editable price/currency/terms form kept in sync
  // with whatever contract is loaded.
  const [contract, setContract] = useState<Contract | null>(null);
  const [contractPrice, setContractPrice] = useState('');
  const [contractCurrency, setContractCurrency] = useState('PHP');
  const [contractTerms, setContractTerms] = useState('');

  function reloadContract() {
    if (isNew) return;
    fetchLeadContract(session.access_token, leadId)
      .then(({ contract }) => {
        setContract(contract);
        if (contract) {
          setContractPrice(String(contract.agreed_price));
          setContractCurrency(contract.currency);
          setContractTerms(contract.terms ?? '');
        }
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reloadContract, [isNew, leadId, session.access_token]);

  // tb-transactions-closing-001: the lead's current closing (most recent
  // row, if any), plus an editable final_price/currency form and a
  // lease_end_date input (only asked for when the closing listing is a
  // rental, mirroring mark-won's own rule) kept in sync with the loaded
  // closing.
  const [closing, setClosing] = useState<Closing | null>(null);
  const [closingFinalPrice, setClosingFinalPrice] = useState('');
  const [closingCurrency, setClosingCurrency] = useState('PHP');
  const [closingLeaseEndDate, setClosingLeaseEndDate] = useState('');

  function reloadClosing() {
    if (isNew) return;
    fetchLeadClosing(session.access_token, leadId)
      .then(({ closing }) => {
        setClosing(closing);
        if (closing) {
          setClosingFinalPrice(String(closing.final_price));
          setClosingCurrency(closing.currency);
        }
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reloadClosing, [isNew, leadId, session.access_token]);

  // tb-commission-structure-001: earnings for the lead's closing, once one
  // exists -- keyed on closing.id rather than leadId/isNew like the other
  // reload* effects, since a closing only exists once the deal is complete.
  const [commissionEarnings, setCommissionEarnings] = useState<CommissionEarnings | null>(null);
  const [commissionTotalInput, setCommissionTotalInput] = useState('');

  useEffect(() => {
    if (!closing) return;
    fetchClosingCommissionEarnings(session.access_token, closing.id)
      .then(({ commission_earnings }) => setCommissionEarnings(commission_earnings))
      .catch((err: Error) => setError(err.message));
  }, [closing, session.access_token]);

  function startCounter(offer: Offer) {
    setCounterOfferId(offer.id);
    setOfferListingId(offer.listing_id);
    setOfferOfferedBy(offer.offered_by === 'buyer' ? 'seller' : 'buyer');
    setOfferAmount(String(offer.amount));
    setOfferCurrency(offer.currency);
    setOfferTerms('');
  }

  function resetOfferForm() {
    setCounterOfferId(null);
    setOfferListingId('');
    setOfferOfferedBy('buyer');
    setOfferAmount('');
    setOfferCurrency('PHP');
    setOfferTerms('');
  }

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
        // Bug fix: `found` is a BuyerRequirement, which is RequirementFields
        // plus stage/won_listing_id/etc. Assigning it wholesale into
        // `requirement` silently smuggled those extra fields along for the
        // ride. `stage` in particular has its own dedicated save path
        // (handleStageChange, via the Stage dropdown below) -- if `requirement`
        // also carried a frozen copy of the stage from page-load time,
        // clicking Save later would PATCH that stale value and silently
        // revert any stage change made via the dropdown in between. Picking
        // only the real RequirementFields keys here keeps requirement's PATCH
        // payload scoped to what this form actually edits.
        setRequirement({
          intent: found.intent,
          property_type: found.property_type,
          budget_min: found.budget_min,
          budget_max: found.budget_max,
          budget_currency: found.budget_currency,
          target_city: found.target_city,
          target_province: found.target_province,
          floor_area_sqm_min: found.floor_area_sqm_min,
          lot_area_sqm_min: found.lot_area_sqm_min,
          storeys: found.storeys,
          bedrooms: found.bedrooms,
          bathrooms: found.bathrooms,
          household_adults: found.household_adults,
          household_kids: found.household_kids,
          household_pets: found.household_pets,
          notes: found.notes,
        });
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

  async function handleScheduleViewing() {
    if (isNew || !viewingListingId || !viewingScheduledAt) return;
    setSaving(true);
    setError(null);
    try {
      await scheduleViewing(session.access_token, {
        buyer_requirement_id: leadId,
        listing_id: viewingListingId,
        scheduled_at: new Date(viewingScheduledAt).toISOString(),
      });
      setViewingListingId('');
      setViewingScheduledAt('');
      reloadViewings();
      // Scheduling a viewing may have advanced the lead's stage server-side --
      // refetch so the Stage dropdown reflects it without a manual reopen.
      const refreshed = await fetchBuyerRequirement(session.access_token, leadId);
      setLead(refreshed);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleViewingOutcome(viewingId: string, outcome: Viewing['outcome']) {
    setError(null);
    try {
      const updated = await updateViewing(session.access_token, viewingId, { outcome });
      setViewings((prev) => prev.map((v) => (v.id === viewingId ? updated : v)));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleRecordOffer() {
    const amount = Number(offerAmount);
    if (isNew || !offerListingId || !offerAmount || !Number.isFinite(amount) || amount <= 0) return;
    setSaving(true);
    setError(null);
    try {
      await recordOffer(session.access_token, {
        buyer_requirement_id: leadId,
        listing_id: offerListingId,
        offered_by: offerOfferedBy,
        amount,
        currency: offerCurrency,
        terms: offerTerms || undefined,
        supersedes_offer_id: counterOfferId ?? undefined,
      });
      resetOfferForm();
      reloadOffers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleResolveOffer(offerId: string, status: 'accepted' | 'rejected' | 'withdrawn') {
    setError(null);
    try {
      const updated = await resolveOffer(session.access_token, offerId, status);
      setOffers((prev) => prev.map((o) => (o.id === offerId ? updated : o)));
      if (status === 'accepted') {
        // Acceptance may have flipped the listing to under_offer and advanced
        // the lead's stage server-side -- refetch so both reflect it without
        // a manual reopen (same reasoning as handleScheduleViewing's refetch).
        const refreshed = await fetchBuyerRequirement(session.access_token, leadId);
        setLead(refreshed);
        onSaved();
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreateContract(offerId: string) {
    setSaving(true);
    setError(null);
    try {
      const created = await createContract(session.access_token, { offer_id: offerId });
      setContract(created);
      setContractPrice(String(created.agreed_price));
      setContractCurrency(created.currency);
      setContractTerms(created.terms ?? '');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveContractTerms() {
    if (!contract) return;
    const agreedPrice = Number(contractPrice);
    if (!contractPrice || !Number.isFinite(agreedPrice) || agreedPrice <= 0) {
      setError('Agreed price must be a positive number');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateContract(session.access_token, contract.id, {
        agreed_price: agreedPrice,
        currency: contractCurrency,
        terms: contractTerms || undefined,
      });
      setContract(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAdvanceSigning(signing_status: SigningStatus) {
    if (!contract) return;
    setError(null);
    try {
      const updated = await updateContract(session.access_token, contract.id, { signing_status });
      setContract(updated);
      if (signing_status === 'signed') {
        // Signing may have advanced the lead's stage to contract_closing
        // server-side -- refetch so the Stage dropdown reflects it without a
        // manual reopen (same reasoning as handleResolveOffer's refetch).
        const refreshed = await fetchBuyerRequirement(session.access_token, leadId);
        setLead(refreshed);
        onSaved();
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleOpenClosing(contractId: string) {
    setSaving(true);
    setError(null);
    try {
      const created = await createClosing(session.access_token, contractId);
      setClosing(created);
      setClosingFinalPrice(String(created.final_price));
      setClosingCurrency(created.currency);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveClosingPrice() {
    if (!closing) return;
    const finalPrice = Number(closingFinalPrice);
    if (!closingFinalPrice || !Number.isFinite(finalPrice) || finalPrice <= 0) {
      setError('Final price must be a positive number');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateClosing(session.access_token, closing.id, {
        final_price: finalPrice,
        currency: closingCurrency,
      });
      setClosing(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCompleteClosing() {
    if (!closing) return;
    const closingListingIsRental = listings.find((l) => l.id === closing.listing_id)?.listing_type === 'rent';
    if (closingListingIsRental && !closingLeaseEndDate) {
      setError('Lease end date is required for a rental closing');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateClosing(session.access_token, closing.id, {
        completed: true,
        lease_end_date: closingListingIsRental ? closingLeaseEndDate : undefined,
      });
      setClosing(updated);
      // Completion may have advanced the lead's stage to won (with
      // won_listing_id/lease_end_date set) and flipped the listing to sold
      // server-side -- refetch so both reflect it without a manual reopen
      // (same reasoning as handleAdvanceSigning's refetch).
      const refreshed = await fetchBuyerRequirement(session.access_token, leadId);
      setLead(refreshed);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRecordCommission() {
    if (!closing) return;
    const totalCommission = Number(commissionTotalInput);
    if (!commissionTotalInput || !Number.isFinite(totalCommission) || totalCommission <= 0) {
      setError('Total commission must be a positive number');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await recordCommissionEarnings(session.access_token, {
        closing_id: closing.id,
        total_commission: totalCommission,
      });
      setCommissionEarnings(created);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkWon() {
    if (isNew || !wonListingId) return;
    if (wonListingIsRental && !leaseEndDate) {
      setError('Lease end date is required for a rental win');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Same embed gap as sendOptions -- mark-won's own response doesn't
      // include buyer_requirement_matches either, so re-fetch to keep the
      // Options Sent list visible alongside the new Won banner.
      await markWon(session.access_token, leadId, wonListingId, wonListingIsRental ? leaseEndDate : undefined);
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
  const latestAcceptedOffer = offers.find((o) => o.status === 'accepted');
  const wonListingIsRental = listings.find((l) => l.id === wonListingId)?.listing_type === 'rent';

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
                <div className="space-y-2">
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
                  {/* tb-buyer-leads-revisit-page-001: a rent-type won listing
                      is a lease -- the agent enters the actual lease end date
                      directly (never calculated) so it can surface on the
                      Revisit page. Sale-type wins never show or send this. */}
                  {wonListingId && wonListingIsRental && (
                    <div className="space-y-1">
                      <Label htmlFor="lease_end_date">Lease end date</Label>
                      <Input
                        id="lease_end_date"
                        type="date"
                        value={leaseEndDate}
                        onChange={(e) => setLeaseEndDate(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* tb-buyer-leads-match-itinerary-001: read-only running history of
              logged matches -- DoD item "visible in a running history on
              that lead's detail view". Logging itself happens on the Search
              page (navigate there via the Search button above), which has
              the ranked candidates this panel doesn't. Distinct from
              "Options Sent" above -- many-per-lead, purely informational,
              never a stage-transition side effect. */}
          {!isNew && matchLogs.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Matched Property History</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {matchLogs.map((log) => (
                  <li key={log.id} className="space-y-0.5">
                    <p className="text-xs">
                      {new Date(log.created_at).toLocaleString()}
                      {log.logged_by_handle ? ` — @${log.logged_by_handle}` : ''}
                    </p>
                    <p>{log.items.map((item) => item.title).join(', ')}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!isNew && lead && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Viewings</p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className={selectClass}
                  value={viewingListingId}
                  onChange={(e) => setViewingListingId(e.target.value)}
                >
                  <option value="">Select listing…</option>
                  {activeListings.map((listing) => (
                    <option key={listing.id} value={listing.id}>
                      {listing.property_title}
                    </option>
                  ))}
                </select>
                <Input
                  type="datetime-local"
                  value={viewingScheduledAt}
                  onChange={(e) => setViewingScheduledAt(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleScheduleViewing}
                  disabled={saving || !viewingListingId || !viewingScheduledAt}
                >
                  Schedule Viewing
                </Button>
              </div>
              {viewings.length === 0 && <p className="text-xs text-muted-foreground">No viewings scheduled yet.</p>}
              {viewings.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {viewings.map((viewing) => {
                    const listing = listings.find((l) => l.id === viewing.listing_id);
                    return (
                      <li key={viewing.id} className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {listing?.property_title ?? viewing.listing_id} —{' '}
                          {new Date(viewing.scheduled_at).toLocaleString()}
                        </span>
                        <select
                          className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                          value={viewing.outcome}
                          onChange={(e) => handleViewingOutcome(viewing.id, e.target.value as Viewing['outcome'])}
                        >
                          {VIEWING_OUTCOMES.map((o) => (
                            <option key={o} value={o}>
                              {o.replace(/_/g, ' ')}
                            </option>
                          ))}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {!isNew && lead && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Offers</p>
              {counterOfferId && (
                <p className="text-xs text-muted-foreground">
                  Countering an existing offer.{' '}
                  <button type="button" className="underline" onClick={resetOfferForm}>
                    Cancel
                  </button>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className={selectClass}
                  value={offerListingId}
                  onChange={(e) => setOfferListingId(e.target.value)}
                  disabled={!!counterOfferId}
                >
                  <option value="">Select listing…</option>
                  {activeListings.map((listing) => (
                    <option key={listing.id} value={listing.id}>
                      {listing.property_title}
                    </option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  value={offerOfferedBy}
                  onChange={(e) => setOfferOfferedBy(e.target.value as 'buyer' | 'seller')}
                >
                  {OFFERED_BY_VALUES.map((v) => (
                    <option key={v} value={v}>
                      {v === 'buyer' ? 'Buyer offered' : 'Seller countered'}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Amount"
                  className="w-32"
                  value={offerAmount}
                  onChange={(e) => setOfferAmount(e.target.value)}
                />
                <Input
                  type="text"
                  placeholder="Currency"
                  className="w-20"
                  value={offerCurrency}
                  onChange={(e) => setOfferCurrency(e.target.value)}
                />
                <Input
                  type="text"
                  placeholder="Terms (optional)"
                  className="min-w-40 flex-1"
                  value={offerTerms}
                  onChange={(e) => setOfferTerms(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRecordOffer}
                  disabled={saving || !offerListingId || !offerAmount}
                >
                  {counterOfferId ? 'Submit Counter' : 'Record Offer'}
                </Button>
              </div>
              {offers.length === 0 && <p className="text-xs text-muted-foreground">No offers recorded yet.</p>}
              {offers.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {offers.map((offer) => {
                    const listing = listings.find((l) => l.id === offer.listing_id);
                    return (
                      <li key={offer.id} className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {listing?.property_title ?? offer.listing_id} —{' '}
                          {offer.offered_by === 'buyer' ? 'Buyer' : 'Seller'} {offer.currency}{' '}
                          {offer.amount.toLocaleString()} ({offer.status.replace(/_/g, ' ')})
                        </span>
                        {offer.status === 'pending' && (
                          <span className="flex shrink-0 gap-1">
                            <Button size="sm" variant="outline" onClick={() => startCounter(offer)}>
                              Counter
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleResolveOffer(offer.id, 'accepted')}>
                              Accept
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleResolveOffer(offer.id, 'rejected')}>
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleResolveOffer(offer.id, 'withdrawn')}
                            >
                              Withdraw
                            </Button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {!isNew && lead && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Contract</p>
              {!contract &&
                (latestAcceptedOffer ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      Accepted offer: {latestAcceptedOffer.currency} {latestAcceptedOffer.amount.toLocaleString()}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCreateContract(latestAcceptedOffer.id)}
                      disabled={saving}
                    >
                      Create Contract
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No accepted offer yet.</p>
                ))}
              {contract && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-32"
                      value={contractPrice}
                      onChange={(e) => setContractPrice(e.target.value)}
                    />
                    <Input
                      type="text"
                      className="w-20"
                      value={contractCurrency}
                      onChange={(e) => setContractCurrency(e.target.value)}
                    />
                    <Input
                      type="text"
                      placeholder="Terms (optional)"
                      className="min-w-40 flex-1"
                      value={contractTerms}
                      onChange={(e) => setContractTerms(e.target.value)}
                    />
                    <Button size="sm" variant="outline" onClick={handleSaveContractTerms} disabled={saving}>
                      Save
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs capitalize text-muted-foreground">
                      Signing status: {contract.signing_status}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      {contract.signing_status === 'drafted' && (
                        <Button size="sm" variant="outline" onClick={() => handleAdvanceSigning('sent')}>
                          Mark Sent
                        </Button>
                      )}
                      {contract.signing_status === 'sent' && (
                        <Button size="sm" variant="outline" onClick={() => handleAdvanceSigning('signed')}>
                          Mark Signed
                        </Button>
                      )}
                      {(contract.signing_status === 'drafted' || contract.signing_status === 'sent') && (
                        <Button size="sm" variant="outline" onClick={() => handleAdvanceSigning('void')}>
                          Void
                        </Button>
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {!isNew && lead && contract?.signing_status === 'signed' && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Closing</p>
              {!closing && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Signed contract: {contract.currency} {contract.agreed_price.toLocaleString()}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => handleOpenClosing(contract.id)} disabled={saving}>
                    Open Closing
                  </Button>
                </div>
              )}
              {closing && !closing.completed_at && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-32"
                      value={closingFinalPrice}
                      onChange={(e) => setClosingFinalPrice(e.target.value)}
                    />
                    <Input
                      type="text"
                      className="w-20"
                      value={closingCurrency}
                      onChange={(e) => setClosingCurrency(e.target.value)}
                    />
                    <Button size="sm" variant="outline" onClick={handleSaveClosingPrice} disabled={saving}>
                      Save
                    </Button>
                  </div>
                  {listings.find((l) => l.id === closing.listing_id)?.listing_type === 'rent' && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="closing_lease_end_date" className="text-xs">
                        Lease end date
                      </Label>
                      <Input
                        id="closing_lease_end_date"
                        type="date"
                        className="w-40"
                        value={closingLeaseEndDate}
                        onChange={(e) => setClosingLeaseEndDate(e.target.value)}
                      />
                    </div>
                  )}
                  <Button size="sm" onClick={handleCompleteClosing} disabled={saving}>
                    Mark Complete
                  </Button>
                </div>
              )}
              {closing?.completed_at && (
                <p className="text-sm text-muted-foreground">
                  Closed: {closing.currency} {closing.final_price.toLocaleString()} on{' '}
                  {new Date(closing.completed_at).toLocaleDateString()}
                </p>
              )}
            </div>
          )}

          {!isNew && closing?.completed_at && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Commission</p>
              {!commissionEarnings && (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Total commission"
                    className="w-40"
                    value={commissionTotalInput}
                    onChange={(e) => setCommissionTotalInput(e.target.value)}
                  />
                  <Button size="sm" onClick={handleRecordCommission} disabled={saving}>
                    Record Commission
                  </Button>
                </div>
              )}
              {commissionEarnings && (
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>
                    Total: {commissionEarnings.currency} {commissionEarnings.total_commission.toLocaleString()}
                  </p>
                  <p>
                    Brokerage ({commissionEarnings.brokerage_pct}%): {commissionEarnings.currency}{' '}
                    {commissionEarnings.brokerage_amount.toLocaleString()}
                  </p>
                  <p>
                    Agent ({commissionEarnings.agent_pct}%): {commissionEarnings.currency}{' '}
                    {commissionEarnings.agent_amount.toLocaleString()}
                  </p>
                  {commissionEarnings.co_broker_pct > 0 && (
                    <p>
                      Co-broker ({commissionEarnings.co_broker_pct}%): {commissionEarnings.currency}{' '}
                      {commissionEarnings.co_broker_amount.toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {!isNew && lead && lead.stage === 'won' && lead.won_listing_id && (
            <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3">
              <p className="text-sm text-emerald-900">
                Won: {listings.find((l) => l.id === lead.won_listing_id)?.property_title ?? lead.won_listing_id}
              </p>
              {lead.lease_end_date && (
                <p className="text-sm text-emerald-900">
                  Lease ends: {new Date(lead.lease_end_date).toLocaleDateString()}
                </p>
              )}
              <Button size="sm" onClick={() => onGoMarkSold(lead.won_listing_id!, lead.contact_id)}>
                Mark Sold on Listings Page
              </Button>
            </div>
          )}

          {!isNew && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Tasks</p>
                <Button size="sm" variant="outline" onClick={() => onOpenTask('new')}>
                  New Task
                </Button>
              </div>
              {tasks.length === 0 && <p className="text-xs text-muted-foreground">No tasks linked to this lead.</p>}
              {tasks.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {tasks.map((task) => (
                    <li
                      key={task.id}
                      className="flex cursor-pointer items-center justify-between text-muted-foreground hover:text-foreground"
                      onClick={() => onOpenTask(task.id)}
                    >
                      <span>{task.title}</span>
                      <span className="text-xs">{task.status.replace(/_/g, ' ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </FloatingPanel>
  );
}
