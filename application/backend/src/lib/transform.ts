import { normalizePropertyType, classifyLocation } from './normalize.js';

// Real `properties` columns (DD-002), not tb-migration-csv-001's illustrative
// example fields (name/listed_date/listing_type/developer/condominium), which
// don't exist on the actual schema. See the tb-migration-csv-001 plan's
// Deviations section.
export const PROPERTY_FIELDS = [
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

// tb-migration-contacts-001: the generic Contact entity's columns. `type` is
// deliberately NOT validated against a fixed set here (unlike property.type)
// -- an open set of buyer_lead/co_broker/developer/owner/etc, per that
// tracer bullet's Context decision.
export const CONTACT_FIELDS = ['name', 'type', 'email', 'phone', 'company', 'notes'] as const;

export type EntityType = 'property' | 'contact';

export const FIELDS_BY_ENTITY: Record<EntityType, readonly string[]> = {
  property: PROPERTY_FIELDS,
  contact: CONTACT_FIELDS,
};

export type TargetField = (typeof PROPERTY_FIELDS)[number] | (typeof CONTACT_FIELDS)[number];

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

// tb-migration-value-normalization-001: property type and city/province
// values from a real CRM export don't come pre-shaped to Residoro's schema
// (free text like "House" instead of the enum, a single "Location" column
// mixing city and province names) -- these run only for entityType ===
// 'property', same as the numeric/owner_type checks above. Currency-
// prefixed prices are already handled by the numeric coercion above (see
// this tracer bullet's Context) and needed no new code.

function isTargetField(value: string, entityType: EntityType): value is TargetField {
  return (FIELDS_BY_ENTITY[entityType] as readonly string[]).includes(value);
}

// sampleProperties/sample_properties is a holdover name from before contacts
// existed (tb-migration-contacts-001) -- it's really "mapped sample records"
// for whichever entity is being migrated. Not renamed on the wire: the
// property flow's response shape is already live and tested, and renaming it
// buys nothing since both fields end up rendered by the same generic
// PreviewTable either way.
export function transformSample(rows: Record<string, string>[], mappings: MappingEntry[], entityType: EntityType) {
  const activeMappings = mappings.filter((m) => isTargetField(m.residoro_field, entityType));

  let errorCount = 0;
  const sampleProperties = rows.map((row, index) => {
    const record: Record<string, unknown> = { row_number: index + 1 };
    const validationErrors: string[] = [];

    for (const { csv_column, residoro_field } of activeMappings) {
      const field = residoro_field as TargetField;
      const rawValue = row[csv_column];

      if (rawValue === undefined || rawValue === '') {
        record[field] = null;
        continue;
      }

      if (entityType === 'property' && NUMERIC_FIELDS.has(field)) {
        const numeric = Number(rawValue.replace(/[^0-9.-]/g, ''));
        if (Number.isNaN(numeric)) {
          validationErrors.push(`${field}: "${rawValue}" is not a number`);
          record[field] = null;
        } else {
          record[field] = numeric;
        }
      } else if (entityType === 'property' && field === 'type') {
        const normalized = normalizePropertyType(rawValue, PROPERTY_TYPES);
        if (normalized.warning) validationErrors.push(normalized.warning);
        record[field] = normalized.value;
      } else if (entityType === 'property' && field === 'owner_type' && !OWNER_TYPES.has(rawValue)) {
        validationErrors.push(`owner_type: "${rawValue}" is not a recognized owner type`);
        record[field] = rawValue;
      } else if (entityType === 'property' && (field === 'city' || field === 'province')) {
        const classification = classifyLocation(rawValue);
        if (classification) {
          record[classification.field] = classification.value;
        } else {
          validationErrors.push(`${field}: "${rawValue}" could not be classified as a known city or province`);
          record[field] = rawValue;
        }
      } else {
        // contact.type is preserved as given, no enum check -- see Context.
        record[field] = rawValue;
      }
    }

    if (validationErrors.length > 0) errorCount += 1;
    record.validation_errors = validationErrors;
    return record;
  });

  return { sampleProperties, errorCount };
}
