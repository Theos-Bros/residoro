import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchReceivedDockets, type ReceivedDocket } from '@/lib/listingsApi';

type Props = {
  session: Session;
};

const FIELD_LABELS: Record<string, string> = {
  listing_type: 'Listing type',
  price: 'Price',
  price_currency: 'Currency',
  exclusivity: 'Exclusivity',
  authority_starts_at: 'Authority starts',
  authority_expires_at: 'Authority ends',
  status: 'Status',
  title: 'Title',
  type: 'Property type',
  address: 'Address',
  city: 'City',
  province: 'Province',
  floor_area_sqm: 'Floor area (sqm)',
  lot_area_sqm: 'Lot area (sqm)',
  bedrooms: 'Bedrooms',
  bathrooms: 'Bathrooms',
  parking_slots: 'Parking slots',
};

// tb-listings-co-broker-share-001: the recipient's read-only view of every
// active docket shared with them, across any tenant -- reflects the live
// state of the source listing on every load (live projection, not a
// snapshot), and never shows anything beyond each docket's own
// included_fields.
export function SharedWithMePage({ session }: Props) {
  const [dockets, setDockets] = useState<ReceivedDocket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchReceivedDockets(session.access_token)
      .then(({ dockets }) => {
        if (!cancelled) setDockets(dockets);
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
      <h1>Shared with me</h1>

      {error && <p role="alert">{error}</p>}
      {!error && dockets === null && <p>Loading…</p>}
      {dockets?.length === 0 && <p>Nothing has been shared with you yet.</p>}

      {dockets && dockets.length > 0 && (
        <ul>
          {dockets.map((docket) => (
            <li key={docket.id} style={{ marginBottom: '1rem' }}>
              <p>
                Shared by <strong>@{docket.shared_by_handle ?? 'unknown'}</strong>
              </p>
              <table>
                <tbody>
                  {Object.entries(docket.fields).map(([field, value]) => (
                    <tr key={field}>
                      <th style={{ textAlign: 'left' }}>{FIELD_LABELS[field] ?? field}</th>
                      <td>{value === null || value === undefined || value === '' ? '—' : String(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
