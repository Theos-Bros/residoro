// Real `properties` columns (DD-002), not tb-migration-csv-001's illustrative
// example fields (name/listed_date/listing_type/developer/condominium), which
// don't exist on the actual schema. See the tb-migration-csv-001 plan's
// Deviations section.
export const TARGET_FIELDS = [
  'title',
  'price',
  'bedrooms',
  'bathrooms',
  'address',
  'city',
  'province',
  'type',
  'owner_type',
  'floor_area_sqm',
  'lot_area_sqm',
  'parking_slots',
] as const;

export type TargetField = (typeof TARGET_FIELDS)[number];

const NUMERIC_FIELDS = new Set<TargetField>([
  'price',
  'bedrooms',
  'bathrooms',
  'floor_area_sqm',
  'lot_area_sqm',
  'parking_slots',
]);

const PROPERTY_TYPES = new Set([
  'condo_unit',
  'house_and_lot',
  'lot_only',
  'townhouse',
  'commercial',
  'warehouse',
  'agricultural',
  'industrial',
]);

const OWNER_TYPES = new Set(['developer', 'individual', 'company']);

export type MappingEntry = { csv_column: string; residoro_field: string };

function isTargetField(value: string): value is TargetField {
  return (TARGET_FIELDS as readonly string[]).includes(value);
}

export function transformSample(rows: Record<string, string>[], mappings: MappingEntry[]) {
  const activeMappings = mappings.filter((m) => isTargetField(m.residoro_field));

  let errorCount = 0;
  const sampleProperties = rows.map((row, index) => {
    const property: Record<string, unknown> = { row_number: index + 1 };
    const validationErrors: string[] = [];

    for (const { csv_column, residoro_field } of activeMappings) {
      const field = residoro_field as TargetField;
      const rawValue = row[csv_column];

      if (rawValue === undefined || rawValue === '') {
        property[field] = null;
        continue;
      }

      if (NUMERIC_FIELDS.has(field)) {
        const numeric = Number(rawValue.replace(/[^0-9.-]/g, ''));
        if (Number.isNaN(numeric)) {
          validationErrors.push(`${field}: "${rawValue}" is not a number`);
          property[field] = null;
        } else {
          property[field] = numeric;
        }
      } else if (field === 'type' && !PROPERTY_TYPES.has(rawValue)) {
        validationErrors.push(`type: "${rawValue}" is not a recognized property type`);
        property[field] = rawValue;
      } else if (field === 'owner_type' && !OWNER_TYPES.has(rawValue)) {
        validationErrors.push(`owner_type: "${rawValue}" is not a recognized owner type`);
        property[field] = rawValue;
      } else {
        property[field] = rawValue;
      }
    }

    if (validationErrors.length > 0) errorCount += 1;
    property.validation_errors = validationErrors;
    return property;
  });

  return { sampleProperties, errorCount };
}
