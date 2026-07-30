import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchRevisitLeads, type RevisitLead } from '@/lib/buyerRequirementsApi';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Props = {
  session: Session;
};

type Bucket = 'expired' | 'expiring_soon' | 'active';

// tb-buyer-leads-revisit-page-001: 30 days, not the 7-day window used
// elsewhere in the app for listing-authority-expiry warnings (see
// ContractWarningBanner) -- a lease-renewal conversation plausibly needs more
// lead time than a contract-authority lapse does. This figure wasn't
// explicitly confirmed with the user; it's a reasonable default, and no
// stronger existing convention for a "soon" window was found in the codebase
// (the authority-expiry flow has no "soon" bucket at all, just
// expired/not-expired) -- revisit this constant if that changes.
const EXPIRING_SOON_DAYS = 30;

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function bucketFor(dateStr: string): Bucket {
  const days = daysUntil(dateStr);
  if (days < 0) return 'expired';
  if (days <= EXPIRING_SOON_DAYS) return 'expiring_soon';
  return 'active';
}

const BUCKET_LABELS: Record<Bucket, string> = {
  expired: 'Expired',
  expiring_soon: 'Expiring Soon',
  active: 'Active',
};

const BUCKET_BADGE_VARIANT: Record<Bucket, 'destructive' | 'default' | 'secondary'> = {
  expired: 'destructive',
  expiring_soon: 'default',
  active: 'secondary',
};

function propertyLabel(lead: RevisitLead): string {
  const props = lead.listing?.properties;
  if (!props) return '—';
  const location = [props.city, props.province].filter(Boolean).join(', ');
  return location ? `${props.title} (${location})` : props.title;
}

// tb-buyer-leads-revisit-page-001: lists every won lead with a captured
// lease-end date (the lead's own rental term, entered on mark-won), sorted
// soonest-first by the backend, bucketed client-side into
// Expired/Expiring Soon/Active. Read-only -- no in-app renewal action here,
// just visibility for an operator to manually re-engage the client. No
// relation to tb-properties-unit-leasing-001's properties.status='leased'.
export function RevisitPage({ session }: Props) {
  const [leads, setLeads] = useState<RevisitLead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRevisitLeads(session.access_token)
      .then(({ revisit_leads }) => setLeads(revisit_leads))
      .catch((err: Error) => setError(err.message));
  }, [session.access_token]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Revisit</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Leased deals from won leads, sorted by lease end date so upcoming renewal conversations
        aren't missed.
      </p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {leads === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {leads?.length === 0 && (
        <p className="text-sm text-muted-foreground">No leased deals with a captured lease end date yet.</p>
      )}

      {leads && leads.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Rent</TableHead>
                <TableHead>Lease End</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => {
                const bucket = bucketFor(lead.lease_end_date);
                return (
                  <TableRow key={lead.id}>
                    <TableCell className="font-medium">{lead.contacts?.name ?? '—'}</TableCell>
                    <TableCell>{propertyLabel(lead)}</TableCell>
                    <TableCell>
                      {lead.listing ? `${lead.listing.price_currency} ${lead.listing.price.toLocaleString()}` : '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {new Date(lead.lease_end_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={BUCKET_BADGE_VARIANT[bucket]}>{BUCKET_LABELS[bucket]}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
