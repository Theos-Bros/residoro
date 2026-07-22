import type { PreviewProperty } from '../lib/migrationsApi';

type Props = {
  property: PreviewProperty;
};

function field(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function formatPrice(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && value !== null ? `₱${numeric.toLocaleString()}` : '—';
}

export function PropertyCard({ property }: Props) {
  const hasErrors = property.validation_errors.length > 0;
  const location = [property.address, property.city, property.province]
    .filter((part) => typeof part === 'string' && part.length > 0)
    .join(', ');

  return (
    <div
      className={`rounded-lg border p-4 shadow-sm ${hasErrors ? 'border-red-400' : 'border-gray-200'}`}
    >
      <p className="text-xs text-gray-500">Row {property.row_number}</p>
      <h3 className="text-lg font-semibold">{field(property.title)}</h3>
      <p className="text-base font-medium">{formatPrice(property.price)}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-600">
        <div>
          <dt className="inline font-medium">Beds:</dt> <dd className="inline">{field(property.bedrooms)}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Baths:</dt> <dd className="inline">{field(property.bathrooms)}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Floor area:</dt>{' '}
          <dd className="inline">{field(property.floor_area_sqm)} sqm</dd>
        </div>
        <div>
          <dt className="inline font-medium">Lot area:</dt>{' '}
          <dd className="inline">{field(property.lot_area_sqm)} sqm</dd>
        </div>
      </dl>
      {location && <p className="mt-2 text-sm text-gray-700">{location}</p>}
      {hasErrors && (
        <ul className="mt-2 text-sm text-red-600">
          {property.validation_errors.map((message, index) => (
            <li key={index}>⚠️ {message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
