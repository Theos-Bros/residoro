import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  fetchProperties,
  updatePropertyVerification,
  matchesKeyword,
  PROPERTY_STATUS_VARIANT,
  VERIFICATION_STATUSES,
  type Property,
  type VerificationStatus,
} from '@/lib/listingsApi';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CreateListingPanel } from '@/components/CreateListingPanel';
import { ListingHistoryPanel } from '@/components/ListingHistoryPanel';
import { cn } from '@/lib/utils';

const verificationSelectClass =
  'h-7 rounded-md border border-input bg-card px-2 text-xs shadow-sm';

type Props = {
  session: Session;
};

type OpenPanel =
  | {
      mode: 'create' | 'history';
      propertyId: string;
      propertyTitle: string;
      price?: number | null;
      priceCurrency?: string;
    }
  | null;

// tb-listings-create-001: the first brokerage-facing property browser --
// properties previously only existed server-side (created via Migration,
// only ever rendered through migration-preview components). Minimal by
// design: title, price, status, and a per-row link into the create-listing
// form, since picking a property is the only thing this tracer bullet needs
// this view to do.
//
// tb-listings-lifecycle-001 (UX follow-up): "Create listing" and "Listing
// history" no longer navigate to a separate route -- they open a floating
// panel (bottom-right, Messenger/Gmail-compose style) so the agent never
// loses their place in this list. Only one panel open at a time. The row
// whose panel is open gets a light-gold highlight (bg-amber-100) so it's
// obvious which property the floating panel refers to.
export function PropertiesListPage({ session }: Props) {
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const { status: workspaceStatus } = useWorkspaceStatus(session);
  const isAdmin = workspaceStatus?.role === 'admin';

  // tb-listings-properties-keyword-search-001: this page's first-ever
  // client-side filter -- previously every fetched property rendered
  // unfiltered. Same component-local, non-persisted pattern as ListingsPage's
  // filter state.
  const [keyword, setKeyword] = useState('');

  const filteredProperties = useMemo(() => {
    if (!properties) return null;
    return properties.filter((property) => matchesKeyword(property.title, property.address, keyword));
  }, [properties, keyword]);

  function reload() {
    fetchProperties(session.access_token)
      .then(({ properties }) => setProperties(properties))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    let cancelled = false;

    fetchProperties(session.access_token)
      .then(({ properties }) => {
        if (!cancelled) setProperties(properties);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [session.access_token]);

  async function handleVerificationChange(propertyId: string, verificationStatus: VerificationStatus) {
    setError(null);
    try {
      await updatePropertyVerification(session.access_token, propertyId, verificationStatus);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Properties</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Every unit and lot your brokerage holds inventory on. Keep status and price current here —
            listings, dockets and client-facing shares all read from these records.
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/properties/new">Add a new listing</Link>
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && properties === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {properties?.length === 0 && <p className="text-sm text-muted-foreground">No properties yet.</p>}

      {properties && properties.length > 0 && (
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Search by title or address…"
            aria-label="Search properties by title or address"
            className="h-9 max-w-sm text-sm"
          />
          <span className="ml-auto hidden font-mono text-xs text-tertiary-foreground sm:inline">
            {filteredProperties?.length ?? 0} of {properties.length} records
          </span>
        </div>
      )}

      {properties && properties.length > 0 && filteredProperties?.length === 0 && (
        <p className="text-sm text-muted-foreground">No properties match the search.</p>
      )}

      {filteredProperties && filteredProperties.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16" />
                <TableHead>Title</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProperties.map((property) => (
                <TableRow key={property.id} className={cn(openPanel?.propertyId === property.id && 'bg-accent/60')}>
                  <TableCell>
                    {property.cover_photo_url ? (
                      <a
                        href={property.cover_photo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View photos"
                        className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-lg hover:bg-accent"
                      >
                        🖼️
                      </a>
                    ) : (
                      <div className="h-10 w-10 rounded-lg bg-muted" />
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link to={`/properties/${property.id}`} className="hover:underline">
                      {property.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {property.price !== null
                      ? `${property.price_currency} ${property.price.toLocaleString()}`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={PROPERTY_STATUS_VARIANT[property.status as keyof typeof PROPERTY_STATUS_VARIANT] ?? 'neutral'}>
                      {property.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <select
                        aria-label={`Verification status for ${property.title}`}
                        value={property.verification_status}
                        onChange={(e) =>
                          handleVerificationChange(property.id, e.target.value as VerificationStatus)
                        }
                        className={verificationSelectClass}
                      >
                        {VERIFICATION_STATUSES.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge variant="neutral">{property.verification_status}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/properties/${property.id}`}>View</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setOpenPanel({
                          mode: 'create',
                          propertyId: property.id,
                          propertyTitle: property.title,
                          price: property.price,
                          priceCurrency: property.price_currency,
                        })
                      }
                    >
                      Create listing
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setOpenPanel({ mode: 'history', propertyId: property.id, propertyTitle: property.title })
                      }
                    >
                      Listing history
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {openPanel?.mode === 'create' && (
        <CreateListingPanel
          session={session}
          propertyId={openPanel.propertyId}
          propertyTitle={openPanel.propertyTitle}
          initialPrice={openPanel.price}
          initialPriceCurrency={openPanel.priceCurrency}
          onClose={() => setOpenPanel(null)}
          onSaved={() => setOpenPanel(null)}
        />
      )}
      {openPanel?.mode === 'history' && (
        <ListingHistoryPanel
          session={session}
          propertyId={openPanel.propertyId}
          propertyTitle={openPanel.propertyTitle}
          onClose={() => setOpenPanel(null)}
        />
      )}
    </div>
  );
}
