import type { PreviewProperty } from '../lib/migrationsApi';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

type Props = {
  properties: PreviewProperty[];
  totalRows: number;
  totalValidationErrors: number;
};

export function PreviewTable({ properties, totalRows, totalValidationErrors }: Props) {
  const columns = properties.length > 0
    ? Object.keys(properties[0]).filter((key) => key !== 'row_number' && key !== 'validation_errors')
    : [];

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Showing {properties.length} of {totalRows} rows.{' '}
        {totalValidationErrors > 0
          ? `${totalValidationErrors} row(s) in this preview have validation errors.`
          : 'No validation errors in this preview.'}
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              {columns.map((col) => (
                <TableHead key={col}>{col}</TableHead>
              ))}
              <TableHead>Errors</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {properties.map((property) => (
              <TableRow key={property.row_number}>
                <TableCell className="font-medium">{property.row_number}</TableCell>
                {columns.map((col) => (
                  <TableCell key={col}>{String(property[col] ?? '')}</TableCell>
                ))}
                <TableCell className="text-destructive">{property.validation_errors.join('; ')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-sm text-muted-foreground">
        No data has been imported to Residoro yet — this is a preview only.
      </p>
    </div>
  );
}
