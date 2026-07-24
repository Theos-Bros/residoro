import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchProperties, type Property } from '@/lib/listingsApi';
import { Button } from '@/components/ui/button';
import { CreateListingPanel } from '@/components/CreateListingPanel';
import { ListingHistoryPanel } from '@/components/ListingHistoryPanel';
import { cn } from '@/lib/utils';

type Props = {
  session: Session;
};

type OpenPanel = { mode: 'create' | 'history'; propertyId: string; propertyTitle: string } | null;

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

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1>Properties</h1>
        <Button asChild size="sm">
          <Link to="/properties/new">Add a new listing</Link>
        </Button>
      </div>

      {error && <p role="alert">{error}</p>}
      {!error && properties === null && <p>Loading…</p>}
      {properties?.length === 0 && <p>No properties yet.</p>}

      {properties && properties.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Price</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {properties.map((property) => (
              <tr key={property.id} className={cn(openPanel?.propertyId === property.id && 'bg-amber-100')}>
                <td>{property.title}</td>
                <td>
                  {property.price !== null ? `${property.price_currency} ${property.price.toLocaleString()}` : '—'}
                </td>
                <td>{property.status}</td>
                <td>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOpenPanel({ mode: 'create', propertyId: property.id, propertyTitle: property.title })}
                  >
                    Create listing
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOpenPanel({ mode: 'history', propertyId: property.id, propertyTitle: property.title })}
                  >
                    Listing history
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {openPanel?.mode === 'create' && (
        <CreateListingPanel
          session={session}
          propertyId={openPanel.propertyId}
          propertyTitle={openPanel.propertyTitle}
          onClose={() => setOpenPanel(null)}
          onCreated={() => setOpenPanel(null)}
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
