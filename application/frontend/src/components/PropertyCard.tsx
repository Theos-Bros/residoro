import type { PreviewProperty } from '../lib/migrationsApi';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

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
    <Card className={cn(hasErrors && 'border-destructive')}>
      <CardHeader className="space-y-1 p-4 pb-0">
        <p className="text-xs text-muted-foreground">Row {property.row_number}</p>
        <h3 className="text-lg font-semibold leading-tight">{field(property.title)}</h3>
        <p className="text-base font-medium">{formatPrice(property.price)}</p>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
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
        {location && <p className="text-sm text-muted-foreground">{location}</p>}
        {hasErrors && (
          <ul className="space-y-1 text-sm text-destructive">
            {property.validation_errors.map((message, index) => (
              <li key={index}>⚠️ {message}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
