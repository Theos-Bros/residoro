import type { ConflictResolution, PreviewConflict } from '../lib/migrationsApi';
import { Badge } from './ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

const RESOLUTION_OPTIONS: { value: ConflictResolution; label: string }[] = [
  { value: 'skip', label: 'Skip (keep existing)' },
  { value: 'create_new', label: 'Create new (duplicate)' },
  { value: 'overwrite', label: 'Overwrite existing' },
];

type Props = {
  totalRows: number;
  conflicts: PreviewConflict[];
  onChange: (rowNumber: number, resolution: ConflictResolution) => void;
};

// tb-migration-deduplication-001: only rendered for property migrations --
// ClientMigration passes an empty conflicts array for contacts, so this
// renders nothing rather than an empty "0 already exist" card.
export function ConflictReviewTable({ totalRows, conflicts, onChange }: Props) {
  if (conflicts.length === 0) return null;

  const toImport = totalRows - conflicts.length;

  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-medium">{toImport}</span> to import,{' '}
        <span className="font-medium">{conflicts.length}</span> already exist{' '}
        <Badge variant="outline">defaults to skip</Badge>
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Already exists as</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {conflicts.map((conflict) => (
              <TableRow key={conflict.row_number}>
                <TableCell className="font-medium">{conflict.row_number}</TableCell>
                <TableCell>
                  {[conflict.address, conflict.city, conflict.province].filter(Boolean).join(', ')}
                </TableCell>
                <TableCell>{conflict.existing_title}</TableCell>
                <TableCell>
                  <select
                    value={conflict.resolution}
                    onChange={(e) => onChange(conflict.row_number, e.target.value as ConflictResolution)}
                    className={selectClass}
                  >
                    {RESOLUTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
