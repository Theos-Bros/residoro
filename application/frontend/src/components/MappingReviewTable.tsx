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
  onChange: (mappings: FieldMapping[]) => void;
};

export function MappingReviewTable({ mappings, onChange }: Props) {
  function updateMapping(index: number, residoro_field: string) {
    const next = mappings.slice();
    next[index] = { ...next[index], residoro_field };
    onChange(next);
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="py-2 pr-4 font-medium">CSV Column</th>
          <th className="py-2 pr-4 font-medium">Residoro Field</th>
        </tr>
      </thead>
      <tbody>
        {mappings.map((mapping, index) => (
          <tr key={mapping.csv_column} className="border-b">
            <td className="py-2 pr-4">{mapping.csv_column}</td>
            <td className="py-2 pr-4">
              <select
                value={mapping.residoro_field}
                onChange={(e) => updateMapping(index, e.target.value)}
                className="rounded-md border border-input px-2 py-1 text-sm"
              >
                {TARGET_FIELD_OPTIONS.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
