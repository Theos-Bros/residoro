import type { FieldMapping } from '../lib/migrationsApi';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

// Mirrors the backend's PROPERTY_FIELDS/CONTACT_FIELDS
// (application/backend/src/lib/transform.ts) -- the real target columns per
// entity, per DD-002 and tb-migration-contacts-001.
export const PROPERTY_FIELD_OPTIONS = [
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

export const CONTACT_FIELD_OPTIONS = ['unmapped', 'name', 'type', 'email', 'phone', 'company', 'notes'];

type Props = {
  mappings: FieldMapping[];
  fieldOptions: string[];
  onChange: (mappings: FieldMapping[]) => void;
};

export function MappingReviewTable({ mappings, fieldOptions, onChange }: Props) {
  function updateMapping(index: number, residoro_field: string) {
    const next = mappings.slice();
    next[index] = { ...next[index], residoro_field };
    onChange(next);
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>CSV Column</TableHead>
            <TableHead>Residoro Field</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mappings.map((mapping, index) => (
            <TableRow key={mapping.csv_column}>
              <TableCell className="font-medium">{mapping.csv_column}</TableCell>
              <TableCell>
                <select
                  value={mapping.residoro_field}
                  onChange={(e) => updateMapping(index, e.target.value)}
                  className={selectClass}
                >
                  {fieldOptions.map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
