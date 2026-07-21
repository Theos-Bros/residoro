import type { FieldMapping } from '../lib/migrationsApi';

// Mirrors the backend's TARGET_FIELDS (application/backend/src/lib/transform.ts) —
// the real `properties` columns, per DD-002.
const TARGET_FIELD_OPTIONS = [
  'unmapped',
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
];

type Props = {
  mappings: FieldMapping[];
  warnings: string[];
  onChange: (mappings: FieldMapping[]) => void;
};

export function MappingReviewTable({ mappings, warnings, onChange }: Props) {
  function updateMapping(index: number, residoro_field: string) {
    const next = mappings.slice();
    next[index] = { ...next[index], residoro_field };
    onChange(next);
  }

  return (
    <div>
      <table border={1} cellPadding={6}>
        <thead>
          <tr>
            <th>CSV Column</th>
            <th>Residoro Field</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {mappings.map((mapping, index) => (
            <tr key={mapping.csv_column}>
              <td>{mapping.csv_column}</td>
              <td>
                <select value={mapping.residoro_field} onChange={(e) => updateMapping(index, e.target.value)}>
                  {TARGET_FIELD_OPTIONS.map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>
              </td>
              <td>{Math.round(mapping.confidence * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {warnings.length > 0 && (
        <ul>
          {warnings.map((warning, i) => (
            <li key={i}>⚠️ {warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
