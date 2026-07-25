import type { FailedRowDetail } from '../lib/migrationsApi';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

type Props = {
  rows: FailedRowDetail[];
};

export function FailedRowsTable({ rows }: Props) {
  if (rows.length === 0) return null;

  const columns = Object.keys(rows[0].original_row);

  return (
    <div className="mt-4 space-y-2">
      <h3 className="text-lg font-semibold tracking-tight">Failed rows</h3>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col}>{col}</TableHead>
              ))}
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={index}>
                {columns.map((col) => (
                  <TableCell key={col}>{row.original_row[col]}</TableCell>
                ))}
                <TableCell className="text-destructive">{row.error_message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
