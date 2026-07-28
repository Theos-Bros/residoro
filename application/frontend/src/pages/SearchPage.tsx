import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  searchInquiry,
  searchBuyerRequirement,
  searchAdHoc,
  fetchMatchingSettings,
  TOGGLE_FIELDS,
  TOGGLE_FIELD_LABELS,
  type MatchResult,
  type MatchableField,
} from '@/lib/matchingApi';
import type { RequirementFields } from '@/lib/inquiriesApi';
import { sendOptions } from '@/lib/buyerRequirementsApi';
import { RequirementFieldsForm } from '@/components/RequirementFieldsForm';
import { BroadcastModal } from '@/components/BroadcastModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type Props = {
  session: Session;
};

type LocationState = {
  sourceType?: 'inquiry' | 'lead';
  sourceId?: string;
  requirement?: RequirementFields;
} | null;

// tb-buyer-leads-matching-001: two sections per the scoping conversation --
// a filter-toggle form on top, a ranked source-tagged card grid below.
// Launchable standalone (blank form, POST /search) or pre-filled from an
// Inquiry/Lead's detail panel via route state (POST .../:id/search, which
// also sets last_searched_at and bumps a fresh/stalled Lead to 'searching').
// intent is deliberately not a toggle -- it's unconditionally hard, per the
// scoping conversation's one fixed rule.
export function SearchPage({ session }: Props) {
  const location = useLocation();
  const state = (location.state as LocationState) ?? null;

  const [requirement, setRequirement] = useState<RequirementFields>(state?.requirement ?? {});
  const [hardFilters, setHardFilters] = useState<Set<Exclude<MatchableField, 'intent'>>>(new Set());
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [matchThreshold, setMatchThreshold] = useState<number | null>(null);
  const [showBroadcast, setShowBroadcast] = useState(false);

  // tb-buyer-leads-broadcast-001: best-effort -- if this fails, the "no good
  // match" broadcast prompt just never shows, matching cap-buyer-leads-001's
  // stance elsewhere on non-critical telemetry-adjacent fetches.
  useEffect(() => {
    fetchMatchingSettings(session.access_token)
      .then((settings) => setMatchThreshold(settings.match_score_threshold))
      .catch(() => {});
  }, [session.access_token]);

  function toggleHardFilter(field: Exclude<MatchableField, 'intent'>) {
    setHardFilters((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function handleSearch() {
    setSearching(true);
    setError(null);
    try {
      const fields = [...hardFilters];
      const response =
        state?.sourceType === 'inquiry' && state.sourceId
          ? await searchInquiry(session.access_token, state.sourceId, fields)
          : state?.sourceType === 'lead' && state.sourceId
            ? await searchBuyerRequirement(session.access_token, state.sourceId, fields)
            : await searchAdHoc(session.access_token, requirement, fields);
      setResults(response.results);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  async function handleSendAsOption(listingId: string) {
    if (state?.sourceType !== 'lead' || !state.sourceId) return;
    setSendingId(listingId);
    setError(null);
    try {
      await sendOptions(session.access_token, state.sourceId, [listingId]);
      setSentIds((prev) => new Set(prev).add(listingId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSendingId(null);
    }
  }

  // tb-buyer-leads-broadcast-001: TB2's "no good match" signal -- a search
  // that came back empty, or where every result scores below
  // match_score_threshold. Only offered when launched from a real Inquiry/
  // Lead (an ad-hoc/blank search has no record to attach the broadcast to).
  const noGoodMatch =
    results !== null &&
    matchThreshold !== null &&
    (results.length === 0 || results.every((r) => r.score < matchThreshold));
  const broadcastEntityType = state?.sourceType === 'inquiry' ? 'inquiry' : 'buyer_requirement';
  const canBroadcast = (state?.sourceType === 'inquiry' || state?.sourceType === 'lead') && !!state.sourceId;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        {state?.sourceType && (
          <p className="text-sm text-muted-foreground">
            Pre-filled from the {state.sourceType === 'inquiry' ? 'Inquiry' : 'Lead'} you opened this from.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="space-y-4 rounded-lg border p-4">
        <RequirementFieldsForm values={requirement} onChange={(patch) => setRequirement((r) => ({ ...r, ...patch }))} />

        <div className="space-y-2">
          <p className="text-sm font-medium">Hard filters (must match exactly — everything else is scored)</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <input type="checkbox" checked disabled className="h-4 w-4 rounded border-input" />
              Intent (always required)
            </span>
            {TOGGLE_FIELDS.map((field) => (
              <label key={field} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={hardFilters.has(field)}
                  onChange={() => toggleHardFilter(field)}
                  className="h-4 w-4 rounded border-input"
                />
                {TOGGLE_FIELD_LABELS[field]}
              </label>
            ))}
          </div>
        </div>

        <Button onClick={handleSearch} disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Results</h2>
        {results === null && <p className="text-sm text-muted-foreground">Run a search to see ranked matches.</p>}
        {results?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No matches — every candidate was excluded by a hard filter, or there's no active inventory or shared
            docket to compare against.
          </p>
        )}

        {noGoodMatch && canBroadcast && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3">
            <p className="text-sm text-muted-foreground">
              No good match — generate a Buyer Wanted broadcast instead.
            </p>
            <Button size="sm" variant="outline" onClick={() => setShowBroadcast(true)}>
              Generate Buyer Wanted broadcast
            </Button>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {results.map((result) => {
              const key = `${result.source}-${result.listing_id}-${result.docket_id ?? ''}`;
              const alreadySent = sentIds.has(result.listing_id);
              return (
                <Card key={key}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                    <CardTitle className="text-base">{result.property_title ?? '(untitled)'}</CardTitle>
                    <Badge variant={result.source === 'inventory' ? 'secondary' : 'outline'}>
                      {result.source === 'inventory' ? 'Your inventory' : `Shared by @${result.shared_by_handle ?? 'unknown'}`}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm">
                      {result.price != null
                        ? `${result.price_currency ?? ''} ${result.price.toLocaleString()}`
                        : 'Price not shared'}
                    </p>
                    <p className="text-sm font-medium">Score: {result.score}</p>
                    {result.matched_fields.length > 0 && (
                      <p className="text-xs text-muted-foreground">Matched: {result.matched_fields.join(', ')}</p>
                    )}
                    {result.excluded_fields.length > 0 && (
                      <p className="text-xs text-muted-foreground">Not matched: {result.excluded_fields.join(', ')}</p>
                    )}
                    {state?.sourceType === 'lead' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSendAsOption(result.listing_id)}
                        disabled={sendingId === result.listing_id || alreadySent}
                      >
                        {alreadySent ? 'Sent' : sendingId === result.listing_id ? 'Sending…' : 'Send as option'}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {showBroadcast && state?.sourceId && (
        <BroadcastModal
          session={session}
          entityType={broadcastEntityType}
          entityId={state.sourceId}
          onClose={() => setShowBroadcast(false)}
        />
      )}
    </div>
  );
}
