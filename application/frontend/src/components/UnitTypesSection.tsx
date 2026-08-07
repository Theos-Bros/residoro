import { useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  createUnitType,
  generateUnits,
  PROPERTY_TYPES,
  type ProjectUnitType,
  type PropertyType,
} from '@/lib/projectsApi';
import { RemoveUnitsPanel } from '@/components/RemoveUnitsPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { FeatureTagInput } from '@/components/ui/feature-tag-input';
import { Badge } from '@/components/ui/badge';

type Props = {
  session: Session;
  projectId: string;
  developerName: string;
  projectName: string;
  unitTypes: ProjectUnitType[];
  onChange: (unitTypes: ProjectUnitType[]) => void;
  onUnitsChanged: () => void;
};

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

function formatSpecs(unitType: ProjectUnitType): string {
  const parts = [
    unitType.floor_area_sqm !== null ? `${unitType.floor_area_sqm} sqm floor` : null,
    unitType.lot_area_sqm !== null ? `${unitType.lot_area_sqm} sqm lot` : null,
    unitType.bedrooms !== null ? `${unitType.bedrooms} BR` : null,
    unitType.bathrooms !== null ? `${unitType.bathrooms} BA` : null,
    unitType.parking_slots !== null ? `${unitType.parking_slots} parking` : null,
    unitType.storeys !== null ? `${unitType.storeys} storey${unitType.storeys === 1 ? '' : 's'}` : null,
    `${unitType.listing_type} · ${unitType.exclusivity}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

// tb-properties-bulk-units-001: unit types are create-only in v1 (no
// PATCH/DELETE route exists) -- a wrong template is fixed by adding a new,
// correctly-specified one, not editing the old one, same as properties'
// own no-generic-edit convention.
//
// tb-properties-project-rollup-001 follow-up: the operator pastes the real
// unit/lot labels (e.g. "1F, 1G, 2A" for a condo floor, or "Block 3 Lot 12,
// Block 3 Lot 13" for a subdivision) instead of a bare count -- these are
// free-form per development convention, not something generated for them.
export function parseUnitNumbers(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function GenerateUnitsRow({
  session,
  projectId,
  unitType,
  onGenerated,
}: {
  session: Session;
  projectId: string;
  unitType: ProjectUnitType;
  onGenerated: () => void;
}) {
  const [unitNumbersInput, setUnitNumbersInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    setResult(null);
    const unitNumbers = parseUnitNumbers(unitNumbersInput);
    if (unitNumbers.length === 0) {
      setError('Enter at least one unit/lot number, separated by commas or new lines.');
      return;
    }

    setBusy(true);
    try {
      const { created, listings_created } = await generateUnits(session.access_token, projectId, unitType.id, unitNumbers);
      setResult(
        `Created ${created} unit${created === 1 ? '' : 's'}, ${listings_created} listing${listings_created === 1 ? '' : 's'} (active).`,
      );
      setUnitNumbersInput('');
      onGenerated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="text"
        value={unitNumbersInput}
        onChange={(e) => setUnitNumbersInput(e.target.value)}
        placeholder="e.g. 1F, 1G, 2A, 2B"
        className="h-8 w-64"
        aria-label={`Unit/lot numbers to generate for ${unitType.name}`}
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

export function UnitTypesSection({
  session,
  projectId,
  developerName,
  projectName,
  unitTypes,
  onChange,
  onUnitsChanged,
}: Props) {
  const [name, setName] = useState('');
  const [propertyType, setPropertyType] = useState<PropertyType>('condo_unit');
  const [floorAreaSqm, setFloorAreaSqm] = useState('');
  const [lotAreaSqm, setLotAreaSqm] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [parkingSlots, setParkingSlots] = useState('');
  const [storeys, setStoreys] = useState('');
  const [features, setFeatures] = useState<string[]>([]);
  const [price, setPrice] = useState('');
  const [listingType, setListingType] = useState<'sale' | 'rent'>('sale');
  const [exclusivity, setExclusivity] = useState<'exclusive' | 'open'>('open');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removingUnitTypeId, setRemovingUnitTypeId] = useState<string | null>(null);

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
        lot_area_sqm: lotAreaSqm ? Number(lotAreaSqm) : undefined,
        bedrooms: bedrooms ? Number(bedrooms) : undefined,
        bathrooms: bathrooms ? Number(bathrooms) : undefined,
        parking_slots: parkingSlots ? Number(parkingSlots) : undefined,
        storeys: storeys ? Number(storeys) : undefined,
        features: features.length > 0 ? features : undefined,
        price: price ? Number(price) : undefined,
        listing_type: listingType,
        exclusivity,
      });
      onChange([...unitTypes, unitType]);
      setName('');
      setFloorAreaSqm('');
      setLotAreaSqm('');
      setBedrooms('');
      setBathrooms('');
      setParkingSlots('');
      setStoreys('');
      setFeatures([]);
      setPrice('');
      setListingType('sale');
      setExclusivity('open');
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
              {unitType.features && unitType.features.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {unitType.features.map((feature) => (
                    <Badge key={feature} variant="secondary">
                      {feature}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <GenerateUnitsRow
                  session={session}
                  projectId={projectId}
                  unitType={unitType}
                  onGenerated={onUnitsChanged}
                />
                <Button size="sm" variant="ghost" onClick={() => setRemovingUnitTypeId(unitType.id)}>
                  Remove units
                </Button>
              </div>
              {removingUnitTypeId === unitType.id && (
                <RemoveUnitsPanel
                  session={session}
                  projectId={projectId}
                  developerName={developerName}
                  projectName={projectName}
                  unitType={unitType}
                  onRemoved={onUnitsChanged}
                  onClose={() => setRemovingUnitTypeId(null)}
                />
              )}
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
                <Label htmlFor="unit_type_lot_area">Lot area (sqm)</Label>
                <Input
                  id="unit_type_lot_area"
                  type="number"
                  min="0"
                  step="0.01"
                  value={lotAreaSqm}
                  onChange={(e) => setLotAreaSqm(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
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
                <Label htmlFor="unit_type_parking">Parking / garage</Label>
                <Input
                  id="unit_type_parking"
                  type="number"
                  min="0"
                  step="1"
                  value={parkingSlots}
                  onChange={(e) => setParkingSlots(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit_type_storeys">Storeys</Label>
                <Input
                  id="unit_type_storeys"
                  type="number"
                  min="0"
                  step="1"
                  value={storeys}
                  onChange={(e) => setStoreys(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit_type_features">Features (optional)</Label>
              <FeatureTagInput id="unit_type_features" value={features} onChange={setFeatures} />
            </div>
            <div className="grid grid-cols-3 gap-3">
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
              <div className="space-y-1.5">
                <Label htmlFor="unit_type_listing_type">Listing type</Label>
                <select
                  id="unit_type_listing_type"
                  value={listingType}
                  onChange={(e) => setListingType(e.target.value as 'sale' | 'rent')}
                  className={selectClass}
                >
                  <option value="sale">Sale</option>
                  <option value="rent">Rent</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit_type_exclusivity">Exclusivity</Label>
                <select
                  id="unit_type_exclusivity"
                  value={exclusivity}
                  onChange={(e) => setExclusivity(e.target.value as 'exclusive' | 'open')}
                  className={selectClass}
                >
                  <option value="open">Open (non-exclusive)</option>
                  <option value="exclusive">Exclusive</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-tertiary-foreground">
              Price/listing type/exclusivity are what each generated unit's listing uses — every
              generated unit is created with an active listing immediately.
            </p>

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
