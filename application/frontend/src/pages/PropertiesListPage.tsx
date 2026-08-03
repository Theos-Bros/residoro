import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { SearchX, Building2 } from 'lucide-react';
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

// tb-design-system-states-mobile-001: same 6-column shape as the real table
// below (photo / title / price / status / verification / actions) so the
// skeleton never causes a layout shift when the real rows swap in. Content
// is a static bg-muted block per cell (design doc's shimmer-on-primary-cell
// dialed back to Tailwind's built-in animate-pulse on the whole row, rather
// than hand-rolling a @keyframes shimmer in index.css -- this file's
// boundary doesn't include index.css, and animate-pulse reads as "loading"
// just as clearly).
function PropertiesTableSkeleton() {
  return (
    <Table>
      <TableBody>
        {Array.from({ length: 6 }).map((_, i) => (
          <TableRow key={i} className="animate-pulse hover:bg-transparent">
            <TableCell>
              <div className="h-10 w-10 rounded-lg bg-muted" />
            </TableCell>
            <TableCell>
              <div className="h-3 w-3/4 rounded-full bg-muted" />
            </TableCell>
            <TableCell className="text-right">
              <div className="ml-auto h-3 w-16 rounded-full bg-muted" />
            </TableCell>
            <TableCell>
              <div className="h-5 w-20 rounded-full bg-muted" />
            </TableCell>
            <TableCell>
              <div className="h-5 w-24 rounded-full bg-muted" />
            </TableCell>
            <TableCell className="text-right">
              <div className="ml-auto h-7 w-20 rounded-md bg-muted" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// tb-design-system-states-mobile-001: one shared shape for both empty-state
// flavors below -- design doc section 11 ("Empty & error") requires the copy
// to diagnose *why* the list is empty (filters vs. genuinely no records) and
// offer both a widening action and a creating action, so both callers pass
// their own icon/headline/description/actions rather than this component
// guessing the cause itself.
function PropertiesEmptyState({
  icon,
  headline,
  description,
  actions,
}: {
  icon: ReactNode;
  headline: string;
  description: string;
  actions: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-accent bg-accent text-accent-foreground">
        {icon}
      </div>
      <p className="text-base font-semibold">{headline}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      <div className="mt-1 flex gap-2.5">{actions}</div>
    </div>
  );
}

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

      {/* tb-design-system-states-mobile-001: loading skeleton replaces the
          bare "Loading…" line while the initial fetch is in flight. */}
      {!error && properties === null && <PropertiesTableSkeleton />}

      {/* Genuinely-zero-records case: no filter is narrowing anything --
          properties itself came back empty -- so there's nothing to "clear",
          only the create action applies. */}
      {properties?.length === 0 && (
        <PropertiesEmptyState
          icon={<Building2 className="h-5 w-5" />}
          headline="No properties yet"
          description="This workspace doesn't hold any inventory yet. Add your first property to start creating listings and dockets from it."
          actions={
            <Button asChild size="sm">
              <Link to="/properties/new">New property</Link>
            </Button>
          }
        />
      )}

      {properties && properties.length > 0 && (
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Search by title or address…"
            aria-label="Search properties by title or address"
            className="h-9 w-full max-w-sm text-sm"
          />
          <span className="ml-auto hidden font-mono text-xs text-tertiary-foreground sm:inline">
            {filteredProperties?.length ?? 0} of {properties.length} records
          </span>
        </div>
      )}

      {/* Filtered-to-zero case: real records exist, the keyword search
          narrowed them to nothing -- offer both widening (clear the search)
          and creating (add a new one, in case it's simply not in inventory
          yet), per design doc section 11. */}
      {properties && properties.length > 0 && filteredProperties?.length === 0 && (
        <PropertiesEmptyState
          icon={<SearchX className="h-5 w-5" />}
          headline="No properties match this search"
          description={`"${keyword}" didn't match any of ${properties.length} records by title or address. Clear the search to see everything, or add a property if this one isn't in inventory yet.`}
          actions={
            <>
              <Button size="sm" variant="outline" onClick={() => setKeyword('')}>
                Clear search
              </Button>
              <Button asChild size="sm">
                <Link to="/properties/new">New property</Link>
              </Button>
            </>
          }
        />
      )}

      {/* tb-design-system-states-mobile-001: below `sm` (640px, same
          breakpoint BrokerageLayout's sidebar/bottom-nav split already uses)
          the table becomes one card per property -- a fixed 6-column table
          doesn't fit a phone viewport. Cards reuse the exact same
          filteredProperties data, PROPERTY_STATUS_VARIANT badge mapping, and
          setOpenPanel handlers as the desktop table below; no new
          data/filtering/mutation logic. Verification status and its select
          are desktop-table-only here -- the design doc's mobile card mock
          (section 07) only shows title/location/price/status/album, and
          working the verification dropdown from a property's own detail
          page is unaffected. */}
      {filteredProperties && filteredProperties.length > 0 && (
        <div className="flex flex-col gap-3 sm:hidden">
          {filteredProperties.map((property) => (
            <div
              key={property.id}
              className={cn(
                'flex flex-col gap-2.5 rounded-xl border bg-card p-3.5',
                openPanel?.propertyId === property.id && 'bg-accent/60',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link to={`/properties/${property.id}`} className="truncate text-sm font-semibold hover:underline">
                    {property.title}
                  </Link>
                  <span className="truncate text-sm text-muted-foreground">{property.address ?? '—'}</span>
                </div>
                {property.cover_photo_url ? (
                  <a
                    href={property.cover_photo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View photos"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-lg hover:bg-accent"
                  >
                    🖼️
                  </a>
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-lg bg-muted" />
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium">
                  {property.price !== null
                    ? `${property.price_currency} ${property.price.toLocaleString()}`
                    : '—'}
                </span>
                <Badge variant={PROPERTY_STATUS_VARIANT[property.status as keyof typeof PROPERTY_STATUS_VARIANT] ?? 'neutral'}>
                  {property.status}
                </Badge>
              </div>

              {property.cover_photo_url ? (
                <a
                  href={property.cover_photo_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-accent-foreground hover:underline"
                >
                  View photos ↗
                </a>
              ) : (
                <span className="text-sm text-tertiary-foreground">No photos yet</span>
              )}

              <div className="flex flex-wrap gap-2 border-t pt-2.5">
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
              </div>
            </div>
          ))}
        </div>
      )}

      {filteredProperties && filteredProperties.length > 0 && (
        <div className="hidden overflow-x-auto rounded-xl border bg-card sm:block">
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
