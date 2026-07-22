import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchProperties, type Property } from '@/lib/listingsApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

// tb-listings-create-001: the first brokerage-facing property browser --
// properties previously only existed server-side (created via Migration,
// only ever rendered through migration-preview components). Minimal by
// design: title, price, status, and a per-row link into the create-listing
// form, since picking a property is the only thing this tracer bullet needs
// this view to do.
export function PropertiesListPage({ session }: Props) {
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <h1>Properties</h1>

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
              <tr key={property.id}>
                <td>{property.title}</td>
                <td>
                  {property.price !== null ? `${property.price_currency} ${property.price.toLocaleString()}` : '—'}
                </td>
                <td>{property.status}</td>
                <td>
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/properties/${property.id}/listings/new`}>Create listing</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
