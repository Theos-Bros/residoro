import {
  INTENTS,
  REQUIREMENT_PROPERTY_TYPES,
  type RequirementFields,
} from '@/lib/inquiriesApi';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toSentenceCase } from '@/lib/utils';

type Props = {
  values: RequirementFields;
  onChange: (patch: Partial<RequirementFields>) => void;
};

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

function numberOrUndefined(raw: string): number | undefined {
  if (raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// tb-buyer-leads-schema-001: the requirement field shape shared by both
// inquiries and buyer_requirements (Decision #2 -- search must be usable
// directly on an Inquiry, not gated behind Lead promotion), so both
// InquiryDetailPanel and LeadDetailPanel render this same set of fields.
export function RequirementFieldsForm({ values, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label>Intent</Label>
        <select
          className={selectClass}
          value={values.intent ?? ''}
          onChange={(e) => onChange({ intent: (e.target.value || undefined) as RequirementFields['intent'] })}
        >
          <option value="">—</option>
          {INTENTS.map((i) => (
            <option key={i} value={i}>
              {toSentenceCase(i)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>Property Type</Label>
        <select
          className={selectClass}
          value={values.property_type ?? ''}
          onChange={(e) =>
            onChange({ property_type: (e.target.value || undefined) as RequirementFields['property_type'] })
          }
        >
          <option value="">—</option>
          {REQUIREMENT_PROPERTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {toSentenceCase(t)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label>Budget Min</Label>
        <Input
          type="number"
          value={values.budget_min ?? ''}
          onChange={(e) => onChange({ budget_min: numberOrUndefined(e.target.value) })}
        />
      </div>
      <div className="space-y-1">
        <Label>Budget Max</Label>
        <Input
          type="number"
          value={values.budget_max ?? ''}
          onChange={(e) => onChange({ budget_max: numberOrUndefined(e.target.value) })}
        />
      </div>

      <div className="space-y-1">
        <Label>Target City</Label>
        <Input value={values.target_city ?? ''} onChange={(e) => onChange({ target_city: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label>Target Province</Label>
        <Input value={values.target_province ?? ''} onChange={(e) => onChange({ target_province: e.target.value })} />
      </div>

      <div className="space-y-1">
        <Label>Floor Area (sqm, min)</Label>
        <Input
          type="number"
          value={values.floor_area_sqm_min ?? ''}
          onChange={(e) => onChange({ floor_area_sqm_min: numberOrUndefined(e.target.value) })}
        />
      </div>
      <div className="space-y-1">
        <Label>Lot Area (sqm, min)</Label>
        <Input
          type="number"
          value={values.lot_area_sqm_min ?? ''}
          onChange={(e) => onChange({ lot_area_sqm_min: numberOrUndefined(e.target.value) })}
        />
      </div>

      <div className="space-y-1">
        <Label>Storeys</Label>
        <Input
          type="number"
          value={values.storeys ?? ''}
          onChange={(e) => onChange({ storeys: numberOrUndefined(e.target.value) })}
        />
      </div>
      <div className="space-y-1">
        <Label>Bedrooms</Label>
        <Input
          type="number"
          value={values.bedrooms ?? ''}
          onChange={(e) => onChange({ bedrooms: numberOrUndefined(e.target.value) })}
        />
      </div>
      <div className="space-y-1">
        <Label>Bathrooms</Label>
        <Input
          type="number"
          value={values.bathrooms ?? ''}
          onChange={(e) => onChange({ bathrooms: numberOrUndefined(e.target.value) })}
        />
      </div>

      <div className="space-y-1">
        <Label>Household: Adults</Label>
        <Input
          type="number"
          value={values.household_adults ?? ''}
          onChange={(e) => onChange({ household_adults: numberOrUndefined(e.target.value) })}
        />
      </div>
      <div className="space-y-1">
        <Label>Household: Kids</Label>
        <Input
          type="number"
          value={values.household_kids ?? ''}
          onChange={(e) => onChange({ household_kids: numberOrUndefined(e.target.value) })}
        />
      </div>
      <div className="space-y-1">
        <Label>Household: Pets</Label>
        <Input
          type="number"
          value={values.household_pets ?? ''}
          onChange={(e) => onChange({ household_pets: numberOrUndefined(e.target.value) })}
        />
      </div>

      <div className="col-span-2 space-y-1">
        <Label>Notes</Label>
        <textarea
          className="flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
          value={values.notes ?? ''}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>
    </div>
  );
}
