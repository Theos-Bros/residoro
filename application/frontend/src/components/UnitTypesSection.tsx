import { useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  createUnitType,
  generateUnits,
  PROPERTY_TYPES,
  type ProjectUnitType,
  type PropertyType,
} from '@/lib/projectsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

type Props = {
  session: Session;
  projectId: string;
  unitTypes: ProjectUnitType[];
  onChange: (unitTypes: ProjectUnitType[]) => void;
};

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

function formatSpecs(unitType: ProjectUnitType): string {
  const parts = [
    unitType.floor_area_sqm !== null ? `${unitType.floor_area_sqm} sqm` : null,
    unitType.bedrooms !== null ? `${unitType.bedrooms} BR` : null,
    unitType.bathrooms !== null ? `${unitType.bathrooms} BA` : null,
    unitType.parking_slots !== null ? `${unitType.parking_slots} parking` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

// tb-properties-bulk-units-001: unit types are create-only in v1 (no
// PATCH/DELETE route exists) -- a wrong template is fixed by adding a new,
// correctly-specified one, not editing the old one, same as properties'
// own no-generic-edit convention.
function GenerateUnitsRow({ session, projectId, unitType }: { session: Session; projectId: string; unitType: ProjectUnitType }) {
  const [count, setCount] = useState('50');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    setResult(null);
    const numericCount = Number(count);
    if (!Number.isInteger(numericCount) || numericCount < 1) {
      setError('Count must be a positive whole number.');
      return;
    }

    setBusy(true);
    try {
      const { created } = await generateUnits(session.access_token, projectId, unitType.id, numericCount);
      setResult(`Created ${created} unit${created === 1 ? '' : 's'}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="number"
        min="1"
        step="1"
        value={count}
        onChange={(e) => setCount(e.target.value)}
        className="h-8 w-24"
        aria-label={`Number of units to generate for ${unitType.name}`}
      />
      <Button size="sm" variant="outline" onClick={handleGenerate} disabled={busy}>
        {busy ? 'Generating…' : 'Generate units'}
      </Button>
      {result && <span className="text-xs text-muted-foreground">{result}</span>}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

export function UnitTypesSection({ session, projectId, unitTypes, onChange }: Props) {
  const [name, setName] = useState('');
  const [propertyType, setPropertyType] = useState<PropertyType>('condo_unit');
  const [floorAreaSqm, setFloorAreaSqm] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [parkingSlots, setParkingSlots] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Unit type name is required.');
      return;
    }

    setSubmitting(true);
    try {
      const unitType = await createUnitType(session.access_token, projectId, {
        name: name.trim(),
        property_type: propertyType,
        floor_area_sqm: floorAreaSqm ? Number(floorAreaSqm) : undefined,
        bedrooms: bedrooms ? Number(bedrooms) : undefined,
        bathrooms: bathrooms ? Number(bathrooms) : undefined,
        parking_slots: parkingSlots ? Number(parkingSlots) : undefined,
        price: price ? Number(price) : undefined,
      });
      onChange([...unitTypes, unitType]);
      setName('');
      setFloorAreaSqm('');
      setBedrooms('');
      setBathrooms('');
      setParkingSlots('');
      setPrice('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {unitTypes.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {unitTypes.map((unitType) => (
            <li key={unitType.id} className="space-y-2 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{unitType.name}</span>
                <span className="text-xs text-muted-foreground">{formatSpecs(unitType)}</span>
              </div>
              <GenerateUnitsRow session={session} projectId={projectId} unitType={unitType} />
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardContent className="space-y-3 pt-6">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="unit_type_name">New unit type name</Label>
              <Input
                id="unit_type_name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 2BR"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit_type_property_type">Property type</Label>
              <select
                id="unit_type_property_type"
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value as PropertyType)}
                className={selectClass}
              >
                {PROPERTY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="unit_type_floor_area">Floor area (sqm)</Label>
                <Input
                  id="unit_type_floor_area"
                  type="number"
                  min="0"
                  step="0.01"
                  value={floorAreaSqm}
                  onChange={(e) => setFloorAreaSqm(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit_type_price">Price (PHP)</Label>
                <Input
                  id="unit_type_price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="unit_type_bedrooms">Bedrooms</Label>
                <Input
                  id="unit_type_bedrooms"
                  type="number"
                  min="0"
                  step="1"
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit_type_bathrooms">Bathrooms</Label>
                <Input
                  id="unit_type_bathrooms"
                  type="number"
                  min="0"
                  step="1"
                  value={bathrooms}
                  onChange={(e) => setBathrooms(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit_type_parking">Parking</Label>
                <Input
                  id="unit_type_parking"
                  type="number"
                  min="0"
                  step="1"
                  value={parkingSlots}
                  onChange={(e) => setParkingSlots(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Separator />
            <Button type="submit" disabled={submitting} size="sm">
              {submitting ? 'Adding…' : 'Add unit type'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
